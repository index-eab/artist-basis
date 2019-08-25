// ==UserScript==
// @name         Artist Basis
// @description  Artist-based tools for e621 including subscriptions and galleries
// @namespace    https://e621.net/basis/watchlist
// @version      2.0.3
// @author       index
// @license      GPL-3.0-or-later
// @match        *://*.e621.net/*
// @match        *://*.e926.net/*
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/index-eab/artist-basis/master/artist_basis.meta.js
// @downloadURL  https://raw.githubusercontent.com/index-eab/artist-basis/master/artist_basis.user.js
// @supportURL   https://e926.net/forum/show/260782
// @grant        GM.getResourceUrl
// @resource     demo    https://raw.githubusercontent.com/index-eaw/artist-basis/master/img/demo_00.png
// @resource     logos   https://raw.githubusercontent.com/index-eaw/artist-basis/master/img/logos_00.png
// @require      https://raw.githubusercontent.com/pieroxy/lz-string/master/libs/lz-string.min.js
// ==/UserScript==

(async function() {
	
	'use strict';
	
	// - General - - - - - - //{
	let notArtists = [ 'unknown_artist','unknown_artist_signature','unknown_colorist','anonymous_artist','avoid_posting','conditional_dnp','sound_warning','epilepsy_warning' ];
	let forbidden = { 'start': ['-', '~', '+'], 'any': [','] };   // characters that cause problems
	let tagLim = { 'e621.net': 6, 'e926.net': 5 };   // higher-tier accounts can increase these
	let roles = [  ];   // 'dev', 'noImage'
	
	let storLim = { 'blacklist': 750, 'sites': 100 };
	let timeout = { 'cache': 90, 'storage': 15, 'gallery': 60*24, 'multisearch': 60*24*365 };   // in minutes
	let ppa = 8;   // posts per artist - increasing results in larger but fewer server requests
	let slow = { warn: 4000, simplify: 4000 };   // milliseconds
	
	
	//}
	// - - navbar prep       //{
	let preStyle = document.createElement('style');
	let preCss = (child, pseudo, margin) => { 
		let css = `
			#navbar li:nth-child(${child}) a::${pseudo} {
				content: " ";
				font-size: 83.3333%;
			} #navbar li:nth-child(${child})::${pseudo} {
				content: "Basis";
				color: #b4c7d9;
				font-weight: 400;
				padding: 0 10px 2px;
				margin: ${margin};
			}`;
		
		if ( roles.includes('active') ) css += `
			#content > div {
				visibility: hidden;
			} #navbar li:nth-child(${child})::${pseudo} {
				background-color: #152f56;
				border-radius: 6px 6px 0 0;
				color: #FFF !important;
			} #navbar .current-page {
				background: none;
				border-radius: 0;
			} #navbar .current-page a {
				color: #b4c7d9 !important;
			}`;
		
		return css;
	};
	
	let path = window.location.pathname.split('/').filter(part => part.length > 0);
	let search = window.location.search.substr(1).split('&');
	if ( search.includes('basis=true') || path.includes('basis') ) roles.push('active');
	
	// backward compatibility: pre-2.0
	if ( path.includes('artist') && path.includes('watchlist') ) window.location.replace(window.location.href.replace('artist', 'basis') + '#redirect');

	if ( path[0] === 'artist' ) preStyle.textContent = preCss(7, 'before', '0 10px 0 -10px');
	else preStyle.textContent = preCss(6, 'after', '0 -10px 0 10px');
	
	preStyle.id = 'eabPreStyle';
	document.documentElement.appendChild(preStyle);
	
	await new Promise(resolve => {
		window.addEventListener('DOMContentLoaded', resolve, { once: true });
	});
	
	
	//}
	// - - misc              //{
	let log, xhr = [ ];
	function quit(msg) {
		if ( log ) log.set('action', msg);
		xhr.forEach( page => page.abort() );
		if ( slowTimeout ) clearTimeout(slowTimeout);
		throw new Error(msg);
	}
	
	document.addEventListener('keydown', e => { if (e.keyCode === 27) quit('Halted with Esc key.'); });
	if (Array.prototype.toJSON) delete Array.prototype.toJSON;  // fuck off prototype.js (note: array.reduce is fucked too)
	
	let now = () => Date.now()/1000;  // alert - freeze at start?
	let lastVisit = now(), lastSaved = now(), cooldown;
	let isNew = t => (t > now() - lastVisit);
	let exp = (time, limit) => ((now() - time)/60 > limit);
	
	let getId = (select, on = document) => on.getElementById(select);
	let getClass = (select, on = document) => on.getElementsByClassName(select);
	let getCss = (select, on = document) => on.querySelectorAll(select);
	
	let timer = wait => new Promise(resolve => setTimeout(resolve, wait));
	let defined = check => check !== undefined;
	let domStatus = { blacklist: false, sites: false, slow: false, prevNext: false };
	let compress = obj => LZString.compressToUTF16(JSON.stringify(obj));
	
	
	// node creator
	let n = {
		elem: (node, props) => {
			if ( props ) for (let [prop, val] of Object.entries(props)) {
				if ( Array.isArray(val) ) val.filter(Boolean).forEach( sub => n.assign(node, prop, sub) );
				else n.assign(node, prop, val);
			}
			return node;
		},
		assign: (node, prop, val) => {
			if ( prop === 'desc' ) node.appendChild(val);
			else if ( prop === 'text' ) node.textContent = val;
			else if ( prop === 'html' ) node.innerHTML = val;
			else if ( prop.substring(0,2) === 'on' ) node.addEventListener(prop.substr(2), val);
			else if ( prop === 'value' ) node.value = val;
			else node.setAttribute(prop, val);
		},
		text: cont => document.createTextNode(cont),
		frag: props => n.elem(document.createDocumentFragment(), props),
		temp: tag => { n[tag] = props => n.elem(document.createElement(tag), props); }
	};
	
	n.a = props => n.elem(document.createElement('a'), { href: 'javascript:void(0);', ...props });
	['div', 'span', 'img', 'style', 'input', 'li', 'option', 'br', 'h4', 'h5', 'form', 'select'].forEach(n.temp);
	let wikiHtml = () => ['h1', 'h2', 'h3', 'h6', 'blockquote', 'textarea', 'p', 'ul', 'ol'].forEach(n.temp);
	
	// GreaseMonkey fix - globalize access to the native e621 mode menu
	try {
		if (PostModeMenu) window.PostModeMenu = PostModeMenu;
	} catch (error) {
		if (!window.PostModeMenu) window.PostModeMenu = window.wrappedJSObject.PostModeMenu;
	}
	
	
	//}
	// - - page handling     //{
	let sh, host = window.location.host.split('.').slice(-2).join('.');
	let e621 = ['e621.net', 'e926.net'].includes(host);
	let paginator = getId('paginator');
	
	let cookie = { }, searchParams = { }, searchFor;
	let deconstr = ( part, obj ) => obj[part.split('=')[0]] = part.split('=')[1];
	document.cookie.split('; ').forEach(part => deconstr(part, cookie));
	window.location.search.substr(1).split('&').forEach(part => deconstr(part, searchParams));
	if ( searchParams.name ) searchFor = decodeURIComponent(searchParams.name);
	
	if (e621) sh = {
		scheme   : () => getId('user_css').value,
		pgFormat : (page) => `/basis/${page}`,
		content  : () => getId('content'),
		loggedIn : () => ('login' in cookie),
		subnav   : () => getId('subnav').firstElementChild,
	};
	
	function modPaginator(mod) {
		if ( !paginator ) return;
		let pages = getCss('a', paginator);
		pages.forEach(p => {
			if ( p.href.includes(mod) ) return;
			if ( p.href.includes('?') ) p.href = p.href.replace('?', `?${mod}&`);
			else p.href = p.href + `?${mod}`;
		});
	}
	
	
	// navbar
	n.sub = (page, text) => n.li({ desc: n.a({ href: page, text }) });
	
	let nav = getId('navbar'), subnav;
	if ( nav ) subnav = sh.subnav();
	else return;
	
	if ( path.includes('artist') ) subnav.appendChild( n.sub(sh.pgFormat('watchlist'), 'Watchlist') );   // backward compatibility - pre-2.0
	document.documentElement.removeChild(preStyle);
	
	let active = getClass('current-page');
	let basis = n.li({ desc: n.a({ href: sh.pgFormat('watchlist'), text: 'Basis' }) });
	nav.insertBefore( n.frag({ desc: [ basis, n.text(' ') ] }), nav.children[6] );
	
	if ( roles.includes('active') ) {
		if ( active.length > 0 ) active[0].className = '';
		basis.className = 'current-page';
		
		subnav.innerHTML = '';
		subnav.appendChild( n.sub(sh.pgFormat('watchlist'), 'Watchlist') );
		subnav.appendChild( n.sub('/tag?type=1&order=date&basis=true', 'Gallery') );
		subnav.appendChild( n.sub(sh.pgFormat('config'), 'Configure') );
		subnav.appendChild( n.sub(sh.pgFormat('help'), 'Help') );
	}
	
	
	// flags
	let artistTags = getCss('.sidebar .tag-type-artist');
	let setTitle = title => document.title = `${title} - ${host.split('.')[0]}`;
	let mode = getId('mode');
	
	if ( search.includes('basis=true') && path.includes('artist') ) roles.push('gallery', 'galleryWiki');
	if ( search.includes('basis=true') && path.includes('tag') && search.includes('type=1') ) roles.push('gallery', 'galleryTag');
	if ( path.includes('basis') && path.includes('watchlist') ) roles.push('watchlist');
	if ( path.includes('basis') && path.includes('help') ) roles.push('wiki', 'help');
	if ( path.includes('basis') && path.includes('config') ) roles.push('wiki', 'config');
	if ( path.includes('basis') && path.includes('search') ) roles.push('gallery', 'search');
	if ( artistTags.length > 0 ) roles.push('artistTags');
	if ( mode ) roles.push('favlist');
	
	if ( roles.length === 0 ) return;
	if ( search.includes('dev') ) roles.push('dev');
	
	let titles = { galleryWiki: 'Artist Gallery', galleryTag: 'Artist Gallery', watchlist: 'Artist Watchlist', help: 'Help: Artist Basis', config: 'Configure: Artist Basis', search: 'Artist Gallery' };
	Object.keys(titles).forEach( page => {
		if ( roles.includes(page) ) setTitle({ galleryWiki: 'Artist Gallery (wikis)', galleryTag: 'Artist Gallery (tags)', watchlist: 'Artist Watchlist', help: 'Help: Artist Basis', config: 'Configure: Artist Basis', search: 'Artist Search' }[page]);
	} );
	
	//}
	
	// - Content - - - - - - //{
	let sites = [ ], extSites = {
		twitter:        { name: 'Twitter',         url: 'twitter.com/home' },
		deviantArt:     { name: 'DeviantArt',      url: 'deviantart.com/notifications/#view=watch' },
		furAffinity:    { name: 'Fur Affinity',    url: 'furaffinity.net/msg/submissions' },
		patreon:        { name: 'Patreon',         url: 'patreon.com/home' },
		pixiv:          { name: 'Pixiv',           url: 'pixiv.net/bookmark_new_illust.php' },
		hentaiFoundry:  { name: 'Hentai Foundry',  url: 'hentai-foundry.com/users/FaveUsersRecentPictures?enterAgree=1&username=', prompt: ' insert_username' },
		newGrounds:     { name: 'NewGrounds',      url: 'newgrounds.com/social' },
		tumblr:         { name: 'Tumblr',          url: 'tumblr.com/dashboard' },
		weasyl:         { name: 'Weasyl',          url: 'weasyl.com/messages/submissions' },
		furryNetwork:   { name: 'FurryNetwork',    url: 'furrynetwork.com' },
		inkBunny:       { name: 'Inkbunny',        url: 'inkbunny.net/submissionsviewall.php?mode=unreadsubs' },
		soFurry:        { name: 'SoFurry',         url: 'sofurry.com/browse/watchlist' },
		fanbox:         { name: 'Pixiv Fanbox',    url: 'pixiv.net/fanbox' },
	};
	let extSiteList = Object.keys(extSites);
	let extSiteParse = ex => {
		let [site, mod] = `${ex}`.split(' ');
		if ( !isNaN(site) && extSiteList[site] ) site = extSiteList[site];
		return { site, mod };
	};
	
	
	//}
	// - - style             //{
	let styleElem, style, scheme = sh.scheme(),
	colors = {
		'default':                    { med: 30, mod: [ 1/3, 1/10, 0, -1/6, -1/2 ], text: [ 'FFFFFF', 'BBBBBB', '000000' ] },
		'hexagon':                    { hsl: (v,o) => `hsla(217,  53%, ${v}%, ${o}%)` },
		'hexagon,skin-hexagon-clean': { hsl: (v,o) => `hsla(217,  53%, ${v}%, ${o}%)` },
		'hexagon,skin-pony':          { hsl: (v,o) => `hsla(268,  53%, ${v}%, ${o}%)` },
		'hexagon,skin-bloodlust':     { hsl: (v,o) => `hsla(  0,   0%, ${v}%, ${o}%)`, med: 20, tSizeAdjust: 1 },
		'hexagon,skin-serpent':       { hsl: (v,o) => `hsla(130,  80%, ${v}%, ${o}%)`, med: 54, text: [ '000000', '0E8121', 'FFFFFF' ] },
		'hexagon,skin-hotdog':        { hsl: (v,o) => `hsla(360, 100%, ${v}%, ${o}%)`, med: 44, text: [ '000000', '660000', 'FF5757' ] }
	};
	
	let sub = param => colors[scheme][param] || colors['default'][param];
	let hsl = (variant, opacity = 100, mod = 0) => sub('hsl')( sub('med')*(1 + sub('mod')[variant] + mod), opacity);
	let color = (variant, opacity = '') => '#' + sub('text')[variant] + opacity;
	let font = (def) => def + ( sub('tSizeAdjust') || 0 ) + 'pt';
	
	let eabWidth = 189, pWidthMin = 80, pPadding = 0.6, rad = '5px';
	let pWidth = (x) => `calc(${Math.max(x, pWidthMin)}px + ${2*pPadding}ex)`;
	
	let logosData = await GM.getResourceUrl('logos'), interfaceData = await GM.getResourceUrl('demo'), logos = { }, logosStyle = '';
	if ( logosData.substring(0, 4) === 'blob' ) logos.blob = logosData;
	else logos.base = logosData;
	
	for (let site in extSites) logosStyle += `.eabExt${site} { background-position: -${extSiteList.indexOf(site)*32}px }`;
	
	style = () => `
		/*  general  */
			.eab input:disabled { background: #555;
			} .eab { text-shadow: 0 0 3px ${color(2)};
			} .favlist .sidebar { text-shadow: none;
			} .eab #paginator { text-shadow: none;
			} .eab:not(.favlist) { display: initial;
			} .eab .sidebar::-webkit-scrollbar { display: none;
			} .eabFade { opacity: 0.5;
			} .eab ol { margin: 0 0 1em 0;
			} .eab ol li { margin-left: 0;
			
			} #content #tag-sidebar .eabHeart {
				position: absolute;
				left: -1em;
				font-weight: normal !important;
			} #content .eabHeart {
				cursor: pointer;
				color: #888;
				text-shadow: -1px 0 #000, 0 1px #000, 1px 0 #000, 0 -1px #000;
			} #content .eabFav {
				color: #FF66A3;
			} #content.eabCap .eabHeart:not(.eabFav) {
				color: #444;
				cursor: default;
			} #paginator.eabWaiting a {
				cursor: not-allowed;
			
			
		/*  sidebar  */
			} .eab:not(.favlist) .sidebar {
				position: sticky;
				top: 0;
				padding-top: 1ex;
				z-index: 100;
			} .eab .sidebar > div {
				margin: 0 0 2em
			} .eab form table {
				width: ${eabWidth}px;
				padding: 0;
			} .eab td {
				padding: 0.5px 0;
			} .eab input, .eab select {
				box-shadow: 0 0 4px ${hsl(4)};
			} #eabSearch input, #eabSearch select {
				float: right;
				width: 80%;
				margin: 0.5px 0;
				top: 0;
			} #eabSearch input[type="submit"] {
				width: 100%;
				float: none;
			} #eabSearch input:not([type="submit"]), #eabSearch select {
				right: 1px;
			} #eabSearch select {
				width: calc(80% + 4px);
				padding: 0;
			} .eab input[type="submit"]:hover {
				/*background: ${hsl(1, 100, -1/10)};*/
				color: ${color(1)};
			} .eabSearch input {
				max-width: ${eabWidth - 6}px;
				width: 100%;
			
			
		/*  gallery  */
			} .eabLayer, .eabLayer div {
				font-size: ${font(10.5)};
				border: 1px solid;
				border-width: 1px 0 1px 1px;
			} .eabLayer {
				margin-top: 1.5em;
				display: none;
				border-image: linear-gradient(to right, rgba(0,0,0,0.5), rgba(0,0,0,0.3) 40%, rgba(0,0,0,0) 90%, rgba(0,0,0,0)) 1;
			} .eabLayer > div {
				padding: 0.2em 0.8em 0.3em;
				background: linear-gradient(to right, ${hsl(3)}, ${hsl(3,80)} 40%, ${hsl(3,0)} 90%);
				border-image: linear-gradient(to right, ${hsl(1)}, ${hsl(1,80)} 40%, ${hsl(1,0)} 90%) 1;
			} .eab .content-post {
				margin-top: -1.5em;
			
			} .eab span.thumb {
				height: inherit;
				margin: 1em 0;
			} .eab img.preview {
				border: none;
				border-radius: ${rad} ${rad} 0 0;
				background: ${hsl(3)};
				box-shadow: 0 0 4px ${hsl(4)};
			} .eab.highlight span.thumb {
				opacity: 0.25;
			} .eab span.thumb.slave {
				opacity: 1;
				
			} .eab .thumb > span:not(.post-score) {
				position: relative;
				display: block;
				margin: auto;
			} .eab .eabArtist {
				color: ${color(0)};
				font-size: ${font(10)};
				background-color: ${hsl(1)};
				border: 1px solid ${hsl(4)};
				border-radius: 0 0 ${rad} ${rad};
				border-width: 0 1px 1px;
				margin-left: -100%;
				margin-right: -100%;
				display: inline-block;
				min-width: 100%;
				max-width: 180px;
				position: relative;
				z-index: 2;
				box-sizing: border-box;
				line-height: 1rem;
			} .eab .eabArtist > span, .eab .eabArtist > a {
				border-top: 1px solid ${hsl(4)};
			} .eab .eabArtist a {
				display: block;
			} .favlist .eabGray {
				color: ${color(1)};
				cursor: default;
				font-style: italic;
				width: 100%;
				display: inline-block;
			} .eab .post-score a, .eab .post-score a:hover {
				color: ${color(0)};
			} .eab .post-date {
				background: ${hsl(2)};
				font-size: ${font(7)};
				line-height: 10pt;
			} .post-date .eabFade {
				padding-left: 0.5ex;
				
			} .eab .post-score .eabHeart, .eab .post-score .eabWiki, .eab .newCounter::before {
				float: left;
				width: 0;
				transition: all 0.15s linear;
				opacity: 0;
			} .eab .newCounter::before {
				overflow: hidden;
				text-align: left;
			} .eab .post-score .eabHeart, .eab .post-score .eabWiki {
				font-size: 10pt;
			} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki, .eab .thumb:hover .newCounter::before {
				opacity: 1;
			} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki, .eabArtist a span:not(.eabFade) {
				padding: 0 0.7ex;
			} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki {
				width: initial;
				border-right: inherit;
			} .eab .expand::before { content: 'expand ';
			} .eab .collapse::before { content: 'collapse ';
			} .eab .thumb:hover .expand::before { width: 7ch;
			} .eab .thumb:hover .collapse::before { width: 9ch;
			} .eab .newCounter, .eab .eabSwfNotice {
				position: absolute;
				top: calc(-${pPadding}ex - 1px);
				right: 0;
				z-index: 10;
				border-radius: 0 ${rad};
				font-family: courier;
				font-size: 8pt;
				line-height: 1.00;
				padding: 0.6ex 0.8ex;
				border: 1px solid ${hsl(4)};
				background: ${hsl(1)};
				cursor: pointer;
			} .eab .eabSwfNotice, .eab .eabSwfNotice:hover {
				color: ${color(0)};
				left: 0;
				right: initial;
				border-radius: ${rad} 0;
			
			
		/*  wiki/config  */
			} .eab.wiki h5 { margin-top: 1.5em;
			} .eab.wiki h3 { margin-bottom: 0.3ex;
			} .eab.wiki img {
				border-radius: 2px;
				margin-left: 1em;
			} .eab textarea {
				box-shadow: none;
				width: ${eabWidth*2 - 4}px;
				font-size: ${font(10)};
			} .eab blockquote, .eab blockquote > p {
				background: ${hsl(1)};
			} .eab #help-sidebar li {
				margin: 0;
			} #eabClearVerify {
				display: none;
			
			} #eabExternal {
				height: 32px;
			} #eabExternalPresets div {
				display: inline-block;
				width: 12em;
				position: relative;
				margin: 0.2ex;
				border: 1px solid ${hsl(4)};
				padding: 0 0 0 0.5ex;
				border-radius: 2px;
				cursor: pointer;
			} #eabExternalPresets span {
				position: absolute;
				top: 50%;
				transform: translateY(-50%);
			} #eabExternalPresets a {
				vertical-align: middle;
			} #eabExternal a, #eabExternalPresets a {
				display: inline-block;
				width: 32px;
				height: 32px;
				${logos.base ? 'background-image: url('+logos.base+');' : ''}
				background-size: auto 32px;
				filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000) drop-shadow(0 0 1px ${hsl(0)});
				margin-right: 0.5ex;
			} ${logosStyle}
			
			#eabExternalPresets div, .eabSave, .eab.wiki img {
				box-shadow: 0 0 4px ${hsl(3)};
				border: 1px solid ${hsl(4)};
				background: ${hsl(0)};
				font-size: ${font(10)};
			} .eab input[type="submit"] {
				/* box-shadow: 0 0 4px ${hsl(3, 100, -1/6)}; */ box-shadow: none;
				/*background: ${hsl(1)};*/ background: none;
				/*border: 1px solid ${hsl(4, 100, -1/5)};*/
				margin: 0.75ex 0 0 !important;
				text-shadow: 0 0 3px ${color(2)};
			} .eabSave:not(.inactive):hover, #eabExternalPresets div:hover, .blItem:not(.demo) div:not(.blInput):not(.inactive):hover {  /* alert */
				background: ${hsl(0, 100, -1/10)};
			} .blItem div:not(.blInput).inactive, .eabSave.inactive {
				color: ${color(0, 80)};
				background: ${hsl(1)};
				box-shadow: none;
			} .eabSave, .eab input[type="submit"] {
				cursor: pointer;
				color: ${color(0)};
				text-align: center;
				border-radius: ${rad};
				padding: 0.1ex 0 0.2ex;
				margin: 0.5ex 0;
				line-height: 11.5pt;
				font-family: verdana,sans-serif;
				box-sizing: content-box;
			} .eabSave {
				width: ${eabWidth - 2}px !important;
			} .eabSave.inactive {
				cursor: default;
				
			} #eabBlacklist {
				margin: 2px 0 0 0 !important;
				width: ${eabWidth*1.5}px;
			} .blItem.demo {
				width: ${eabWidth*1.25}px;
			} .blItem {
				list-style-type: none;
				margin: 0;
			} .blInput {
				text-shadow: none;
			} .blItem.demo * {
				cursor: default !important;
			} .blItem div:last-child {
				width: auto;
				border-left-width: 1px;
				background: #FFF;
				overflow: hidden;
				color: #000;
				padding-left: 2px;
				white-space: nowrap;
			} .blInput:focus {
				background: #FFC;
			} .blItem div:not(.blInput) {
				cursor: pointer;
				float: right;
				color: ${color(0)};
				width: 3ex;
				text-align: center;
			} .blItem div {
				background: ${hsl(0)};
				border: 1px solid ${hsl(4)};
				border-width: 0 1px 1px 0;
				vertical-align: bottom;
				text-overflow: ellipsis;
				position: relative;
				z-index: 1000;
				font-size: ${font(9)};
				padding: 0.1ex 0 0.2ex;
			} .blItem:first-child div {
				border-top-width: 1px;
			} .blItem:first-child div:last-child { border-top-left-radius: ${rad}; }
			.blItem:first-child div:first-child { border-top-right-radius: ${rad}; }
			.blItem:last-child div:last-child { border-bottom-left-radius: ${rad}; }
			.blItem:last-child div:first-child { border-bottom-right-radius: ${rad}; }
			
			.eabSave, .blItem div:not(.blInput), #eabExternalPresets div, .eabHeart {
				-moz-user-select: none;
				-webkit-user-select: none;
				user-select: none;
			}
	`;
	
	document.head.appendChild(styleElem = n.style({ text: style() }));
	if ( e621 ) getId('user_css').addEventListener('change', () => {
		scheme = event.target.value;
		styleElem.innerHTML = style();
	});
	
	
	//}
	// - - wiki              //{
	let wikiTemplate = (intro, topics) => 
		n.div({ id: 'wiki-show', class: 'eab wiki', desc: [
			n.div({ 'class': 'sidebar', id: 'help-sidebar', style: 'margin-bottom: 1em', desc: [
				layout.status(),
				n.h4({ text: 'Topics' }),
				n.div({ width: '240px',   desc: n.ul({ class: 'link-page', desc:
					topics.map( topic => n.li({ desc: n.a({ href: `#eab${topic}`, text: `» ${wiki.topics[topic]}` }) }) )
				}) }),
			] }),
			
			n.div({ id: 'wiki-body', desc: [
				//wiki[intro](),
				...topics.map( topic => n.blockquote({ desc: [
					n.h3({ text: wiki.topics[topic], id: `eab${topic}` }),
					...wiki[topic]()
				] }) )
			]}),
			
			n.div({ class: 'Clear' })
		] });
	
	let wiki = {
		topics: { blacklist: 'Blacklist', external: 'External sites', tips: 'Performance', cache: 'Cache management', interface: 'Interface', galleries: 'Galleries', restoration: 'Restoring data' },
		help : () => n.p({ style: 'margin-top: 0.5ex', html: `My thread is over <a href="/forum/show/260782">here</a>, I'd love to hear from you. Thoughts, suggestions, any sort of feedback is welcome!` }),
		config : () => n.p(),
		
		blacklist : () => [
			n.p({ text: `Like the site blacklist, this accepts a list of tags separated by spaces. Ratings are toggled on the right. The only permitted modifier is the minus sign to negate a tag. Examples are listed below.` }),
			
			n.h5({ text: 'Configure' }),
			n.div({ id: 'eabBlCont', text: 'Waiting...' }),
			
			n.h5({ text: 'Examples' }),
			n.p({ text: `Blocks explicit and questionable posts tagged "mammal":`, style: 'margin: 0 0 0.25em' }),
			n.div({ desc: blItem('mammal', 'eq', 'demo') }),
			n.p({ text: `Blocks all posts tagged with both "anthro" and "mammal":`, style: 'margin: 0.75em 0 0.25em' }),
			n.div({ desc: blItem('anthro mammal', 'sqe', 'demo') }),
			n.p({ text: `Blocks safe posts tagged with "anthro" but not "mammal":`, style: 'margin: 0.75em 0 0.25em' }),
			n.div({ desc: blItem('anthro -mammal', 's', 'demo') }), n.br(),
		],
		
		external : () => {
			let eabExtPreset = site => n.div({ 'data-site': site, desc: [
					n.a({ ...logos.blob && { style: `background-image: url(${logos.blob})` }, class: `eabExt${site}` }),
					n.span({ text: extSites[site].name })
				] });
			
			return [
				n.p({ text: `This part of the sidebar links to subscriptions on other sites where artists upload their work directly. As you select sites to include in the Configure section, a preview of your subscriptions will be shown below.` }),
				n.div({ id: 'eabEsCont', text: 'Waiting...' }),
				
				n.h5({ text: 'Configure' }),
				n.div({ id: 'eabEsConfigCont', text: 'Waiting...' }),
				n.p({ text: `Click the buttons below to add sites. The box above can be directly modified to reorganize them. Arbitrary URLs are not currently supported.` }),
				n.p({ text: `Advanced: A site name can be followed by a space and some text to add that text to the end of link URL. This can be used on some sites to refine the watchlist, for instance.` }),
				
				n.div({ id: 'eabExternalPresets', style: 'margin-bottom: 1em', desc: [
					n.h6({ text: 'Presets' }),
					...['furAffinity', 'inkBunny', 'soFurry', 'furryNetwork'].map( eabExtPreset ),   n.br(),  // furry art networks
					...['pixiv', 'deviantArt', 'newGrounds', 'hentaiFoundry'].map( eabExtPreset ),   n.br(),  // art networks
					...['twitter', 'tumblr'].map( eabExtPreset ),   n.br(),  // social
					...['patreon', 'fanbox'].map( eabExtPreset ),  // crowdfunding
				] })
			];
		},
		
		tips : () => [
			n.p({ text: `Here are a couple of tips to keep the tool running as fast as possible (and to stay nice to the servers):` }),
			n.ul({ desc: [
				n.li({ style: 'margin-bottom: 0.75ex', html: `<b>Artist watchlist</b>: To make the server requests much more performant, the watchlist reorganizes itself on each save. It only saves when all artists are processed, so it's recommended to let the watchlist finish loading before leaving the page.` }),
				n.li({ html: `<b>Artist gallery</b>: Your browser cannot keep a cache in private browsing mode. In the gallery, it's recommended to stay out of private mode so redundant server requests don't need to be made.` }),
			] }),
		],
		
		interface : () => [
			n.p({ text: `The organization of links in a thumbnail changed in version 2.0. The image below explains the links shown when a thumbnail is hovered over.` }),
			n.p({ desc: n.img({ src: interfaceData }) }),
			n.p({ text: `In the artist gallery, flash files are not normally shown because there is no thumbnail to represent the artist's work. When it appears, click the "swf" to be taken to the more popular flash file.` }),
		],
		
		galleries : () => [
			n.p({ html: `The site has two artist databases, <a href="/tag?name=&type=1&order=count">one for tags</a> and <a href="https://e621.net/artist/index">one for wikis</a>. They have different pros and cons, so Artist Basis makes both available in a gallery format.` }),
			n.ul({ desc: [
				n.li({ text: 'Tag Gallery', desc: n.ul({ desc: [
					n.li({ text: `Better sorted by date, allowing the tool to operate faster. If you want to browse all artists, this is the best way to do it.` }),
					n.li({ text: `Includes all artists, namely those without a wiki entry. The wiki gallery is about a third of the size of this one.` }),
				] }) }), n.br(),
				n.li({ text: 'Wiki Gallery', desc: n.ul({ desc: [
					n.li({ text: `More options to search with, like gallery URL.` }),
					n.li({ text: `Searching will find aliases as well. Artists without wikis or with incomplete ones won't be found.` }),
				] }) }), n.br(),
				n.li({ text: 'Arist Search', desc: n.ul({ desc: [
					n.li({ text: `Searches for identical and partially matching tags as well as aliases, taking results from the other two galleries.` }),
				] }) })
			] }),
			n.p({ text: `Note that the Tag Gallery is the only one that doesn't automatically apply wildcards ( * ) to the beginning and end of your search.` })
		],
		
		cache : () => [
			n.p({ text: `Artist Basis makes extensive use of caching to cut down on server requests. Every cache entry expires automatically, but if you ever need to clear a cache, you can do so here.` }),
			n.ul({ desc: [
				n.li({ desc: n.a({ text: 'Watchlist', onclick: () => {
					storage('eabInvalidateCache', now());
					log.set('action', 'Watchlist cache invalidated.');
				} }) }),
				n.li({ desc: n.a({ text: 'Gallery', onclick: clearIdb }) }),
				n.li({ desc: n.a({ text: 'Script state', onclick: clearStorage }) }),
			] }),
			n.p({ id: 'eabClearVerify', desc: [ n.a({ text: 'Click to verify:' }), n.text(' clear '), n.span({ text: '___' }), n.text(' cache entries?') ] })
		],
		
		restoration : () => [
			n.ol({ desc: [
				n.li({ desc: [ n.a({ text: 'Create a current backup', onclick: backup }), n.text(` first.`) ] }),
				n.li({ text: `Open the backup you'd like to restore in a simple text reader program. Your web browser is a reliable option. Copy the contents.` }),
				n.li({ html: `Check this <a href="/set?name=artist_watchlist">set list</a> for a private set created by your account. `, desc: n.ul({ desc:
					n.li({ text: `Very old versions of the tool may have created multiple sets. If you find an extra set that hasn't been updated in a long time, you can safely delete it.` })
				}) }),
				n.li({ text: `Edit the set, and paste the backup into the set description field.` }),
				n.li({ desc: n.a({ text: `Clear the script's state.`, onclick: clearStorage }) })
			] })
		]
	};
	
	
	//}
	// - - config modules    //{
	function saveCycle(state, module, button, handler, notice) {
		if ( domStatus[module] === state ) return;
		domStatus[module] = state;
		
		button.innerHTML = { active: notice || 'Save', inactive: 'Saved', saving: 'Saving...' }[state];
		button.className = 'eabSave' + { active: '', inactive: ' inactive', saving: ' inactive' }[state];
		button.onclick =  { active: handler, inactive: undefined, saving: undefined }[state];
	}
	
	let config = {
		blacklist : () => {
			blSection = n.ul({ id: 'eabBlacklist' });
			blInputList = getClass('blInput', blSection);
			document.addEventListener('click', blUnfocus);
			
			for (let tag in black) blSection.appendChild( blItem(tag, black[tag]) );
			blSection.appendChild( blItem('', 'sqe') );
			
			return n.frag({ desc: [
				blSection,
				blSaveElem = n.div({ class: 'inactive eabSave', text: 'Save' })
			] });
		},
		
		external : () => {
			let textarea = n.textarea({ rows: 6, spellcheck: false, onkeyup: () => updateSites().then(refresh) });
			let refresh = () => getId('eabExternal').parentElement.replaceChild( siteList(), getId('eabExternal') );
			let esSaveElem, updateSites = () => {
				saveCycle('active', 'sites', esSaveElem, save);
				return Promise.resolve( sites = textarea.value.replace('\r', '').split('\n').filter( site => site.length > 0 ) );
			};
			
			textarea.value = sites.map( ex => {
				let {site, mod} = extSiteParse(ex);
				return mod ? `${site} ${mod}` : site;
			}).join('\n');
			
			let addSite = site => {
				let existing = sites.findIndex( ex => (ex.split(' ')[0] === site.split(' ')[0]) );
				if ( existing > -1 ) sites.splice(existing, 1);
				else sites.push(site + (extSites[site].prompt || ''));
				
				refresh();
				textarea.value = sites.join('\n');
			};
			
			let save = () => {
				saveCycle('saving', 'sites', esSaveElem, save);
				let newSites = [ ...new Set( sites.map( ex => {
					let [site, mod] = ex.split(' ');
					if ( extSites[site] ) return extSiteList.indexOf(site) + ( mod ? ` ${mod}` : '' );
				}).filter(defined) ) ];
				
				let len = compress(newSites).length;
				if ( len > storLim.sites ) return saveCycle('active', 'sites', esSaveElem, save, `Too long! ${len}/${storLim.sites}`);
				
				prefs.sites = newSites;
				saveChanges().then( () => saveCycle('inactive', 'sites', esSaveElem, save) );
			};
			
			getCss('#eabExternalPresets div').forEach( button => button.addEventListener('click', () => updateSites().then(addSite(button.dataset.site))) );
			return n.frag({ desc: [
				textarea,
				esSaveElem = n.div({ class: 'eabSave inactive', text: 'Save' })
			] });
		}
	};
	
	
	//}
	// - - blacklist         //{
	let black, blInputList, blSection, blSaveElem, blReady = true;
	let blItem = (tag, ratings, demo = false) => n.li({ class: `blItem ${demo || ''}`, desc: [
		...['s','q','e'].map(r =>
			n.div({ 'text': r, 'class': (ratings.includes(r)) ? 'active' : 'inactive', ... !demo && { 'onclick': blRatingCycle } })
		),  n.div({ 'data-ratings': ratings, 'class': 'blInput', 'text': tag, spellcheck: false, 'desc': n.br(),
			... !demo && { 'contenteditable': 'true', 'onfocus': blAdjust, 'oninput': [ blAdjust, () => saveCycle('active', 'blacklist', blSaveElem, blSave) ], 'onkeypress': blEnter }
		})
	] });
	
	function blUnfocus(e) {
		if ( blSection !== e.target && !blSection.contains(e.target) ) blSection.style.width = `${eabWidth*1.5}px`;
		
		for ( let i = 0; i < blInputList.length - 1; ) {
			if ( e.target === blInputList[i] || e.target.parentNode === blInputList[i].parentNode ) i++;
			else if ( blInputList[i].textContent.length === 0 ) blInputList[i].parentNode.remove();
			else i++;
		}
		if ( blInputList[blInputList.length-1].textContent.length !== 0 ) blSection.appendChild( blItem('', 'sqe') );
	}
	
	function blAdjust(e) {
		if ( !blReady ) return e.target.blur();
		if ( !blAdjust.context ) {
			let canvas = document.createElement('canvas');
			blAdjust.context = canvas.getContext('2d');
			blAdjust.context.font = '9pt verdana';
		}
		
		let width = blAdjust.context.measureText(e.target.textContent + 'mxxxxxxxxx').width; // em + 9ex
		blSection.style.width = Math.max(width, eabWidth*1.5) + 'px';
		
		if (blInputList[blInputList.length-1].textContent.length !== 0) blSection.appendChild( blItem('', 'sqe') );
	}
	
	function blEnter(e) {
		if (e.keyCode !== 13) return;
		blInputList[blInputList.length - 1].focus();
		e.preventDefault();
	}
	
	function blRatingCycle(e) {
		if (!blReady) return;
		let c = e.target.innerHTML, input = e.target.parentNode.lastElementChild, ratings = input.dataset.ratings;
		
		e.target.className = ratings.includes(c) ? 'inactive' : 'active';
		ratings = ratings.includes(c) ? ratings.replace(c, '') : ratings + c;
		
		input.dataset.ratings = ratings;
		saveCycle('active', 'blacklist', blSaveElem, blSave);
	}
	
	function blSave() {
		blReady = false;
		saveCycle('saving', 'blacklist', blSaveElem, blSave);
		
		black = {};
		Array.from(blInputList).forEach(elem => {
			if ( elem.textContent !== '' ) black[elem.textContent] = elem.dataset.ratings;
		});
		
		let len = compress(black).length;
		if ( len > storLim.blacklist ) return saveCycle('active', 'blacklist', blSaveElem, blSave, `Too long! ${len}/${storLim.blacklist}`);
		
		prefs.blacklist = black;
		saveChanges().then( () => {
			storage('eabInvalidateCache', now());
			saveCycle('inactive', 'blacklist', blSaveElem, blSave);
			blReady = true;
		} );
	}
	
	
	//}
	// - - layout/sidebar    //{
	let content = sh.content(), loggedIn = sh.loggedIn();
	let gallery, posts, postList, sidebar, status;
	
	let help = {
		span : title => n.span({ class: 'searchhelp', style: 'cursor:help', title, html: '&nbsp; (?)' }),
		a : href => n.a({ class: 'searchhelp', html: '&nbsp; (help)', href })
	};
	
	log = {
		action : n.div({ text: 'Waiting...' }),
		notice : (text, id) => {
			if ( status ) status.insertBefore( n.div({ ...id && { id: `eabLog_${id}` }, style: 'margin-bottom: 1em', text }), log.action );
		},
		
		clear : id => {
			let del = getId(`eabLog_${id}`);
			if ( del ) del.parentNode.removeChild(del);
		}, set : (line, txt) => {
			if (log[line].textContent === txt) return;
			log[line].textContent = txt;
			if (roles.includes('dev')) console.log(`Log: ${txt}`);
		}, ready : () => {
			log.set('action', 'Ready!');
			log.action.appendChild( n.frag({ desc: [ n.text(' Click '), eabHeart('eabExample', ''), n.text(' anywhere on the site to add an artist.') ] }) );
		}, done : message => {
			log.clear('slowMode');
			log.set('action', message || 'Done!');
		}
	};
	
	let galleryLink = (page, params) => {
		if ( roles.includes(page) ) params = { ...params, style: `${params.style || ''} font-weight: bold; color: ${color(1)}` };
		return roles.includes(page) ? n.span(params) : n.a(params);
	}, middot = () => n.span({ style: 'font-weight: bold', text: ' · ' });
	
	let layout = {
		status : () => status = n.div({ desc: [
			n.h4({ text: titles[ Object.keys(titles).find( page => roles.includes(page) ) ] }),
			...roles.includes('gallery') ? [
				galleryLink('galleryTag', { text: 'tags', href: '/tag?type=1&order=date&basis=true', style: 'display: inline-block; margin: 0 0 1.25ex 2ex;' }), middot(),
				galleryLink('galleryWiki', { text: 'wikis', href: '/artist?basis=true' }), middot(),
				galleryLink('search', { text: 'search', href: '/basis/search' })
			] : [],   log.action
		] }),
		
		// Not here? Try <a>searching the Wiki Gallery</a>, which also scans aliases.
		manage : () => n.div({ class: 'eabSearch', desc: [
			n.h5({ text: 'Find an artist' }),
			n.form({ action: '/basis/search', method: 'get', desc: [
				n.input({ name: 'name', type: 'text',
				...( roles.includes('search') && searchFor ) && { value: searchFor } }),
				n.input({ type: 'submit', value: '[ search ]' }),
			] })
		] }),
		
		search : () => {
			let form = getCss('#content form')[0];
			let inputs = getCss('input', form);
			let selects = getCss('select', form);
			let tds = getCss('td', form);
			
			tds.forEach( td => { if (td.width) td.removeAttribute('width'); } );
			[...inputs, ...selects].forEach(input => {
				if ( input.size ) input.removeAttribute('size');
				if ( input.style ) input.removeAttribute('style');
				if ( input.type === 'submit' ) input.value = '[ search ]';
			});
			
			form.appendChild(n.input({ name: 'basis', 'value': true, hidden: true }));
			
			if ( roles.includes('galleryTag') ) {
				let tbody = form.querySelectorAll('form tbody')[0];
				tbody.removeChild(tbody.children[3]);
				tbody.children[1].style.display = 'none';
			} else if ( !search.includes('order=updated') ) selects[2].selectedIndex = -1;
			
			return n.div({ id: 'eabSearch', desc: [
				n.h5({ text: 'Search' }),
				form
			] });
		},
		
		misc : () => n.div({ desc: [
			n.h5({ text: 'Miscellaneous' }),
			n.div({ desc: n.a({ text: 'Create backup', onclick: backup }) }),
			n.div({ desc: n.a({ href: `${window.location.origin}/forum/show/260782`, text: 'Forum thread' }) })
		] }),
		
		sites : (cond = sites.length) => !cond ? false : n.div({ desc: [
			n.h5({ text: 'Other sites' }),
			siteList()
		] })
	};
	
	let siteList = () => n.div({ id: 'eabExternal', desc: sites.map( ex => {
		let {site, mod} = extSiteParse(ex);
		if ( !extSites[site] ) return;
		
		let href = 'https://www.' + extSites[site].url + (mod || '');
		return n.a({ href, ...logos.blob && { style: `background-image: url(${logos.blob})` }, title: extSites[site].name, class: `eabExt${site}` });
	}).filter(defined) });
	
	let eabLayout = () => n.frag({ desc: [
		postList = n.div({ id: 'post-list', class: 'eab', desc: [
			sidebar = n.div({ class: 'sidebar', desc: layout.status() }),
			gallery = n.div({ class: 'content-post' })
		] }), n.div({ class: 'Clear' })
	] });
	
	let fKey;
	window.addEventListener( 'keyup', e => { if ( e.keyCode === 70 ) fKey = false } );
	window.addEventListener( 'keydown', e => { if ( e.keyCode === 70 ) fKey = true } );
	let eggs = [ `J'suis d'accord pour le cinéma_Pour le rock, le twist ou le cha-cha`, `NOW FROM THIS SOLAR SYSTEM_TO ANOTHER I FLY`, `Pump up the jam, pump it up_While your feet are stumpin`, `You had something to hide_Should have hidden it, shouldn't you`, `Oh oh, luxury_Chidi ching ching could buy anything`, `Bass solo_Take 1`, `Who the fuck is this_Pagin me at 5:46 in the morning_Crack of dawn and now I'm yawnin`, `Mike picked up the phone_Just like every other night Mike had to go home`, `Yeah_Here comes Amos`, `Hm hmm, my, hm hm. Mmm, meh, hm hm_These illusions in my head (I never wanna leave)`, `Am I throwing you off?_Didn't think so`, `Scanning the scene on the city tonight_Looking for you to start up a fight`, `The game of chess is like a sword fight_You must think first (HEE) before you move`, `Tak samo znów bez żadnych słów_Odchodzisz i zostawisz mnie tu`, `There I was completely wasted, out of work and down_All inside it's so frustrating as I drift from town to town`, `Alright you primitive screwheads, listen up_This is my BOOMSTICK`, `I'm not very good at uh, singing songs_But uh, here is a_Here is a try` ];
	let eggLetter = (event, i, egg) => {
		if ( !i ) {
			if ( !event.shiftKey || !fKey || event.target.dataset.egg ) return;
			i = 0;
			event.target.textContent = '';
			event.target.dataset.egg = 'true';
			egg = eggs[Math.floor(Math.random()*eggs.length)];
			eggs.splice(eggs.indexOf(egg), 1); 
		}
		
		event.target.appendChild( egg.charAt(i) === '_' ? n.br() : n.text(egg.charAt(i)) );
		if ( i+1 !== egg.length ) timer(30).then( () => eggLetter(event, i+1, egg) );
	}
	
	//}
	
	// - Initialization  - - //{
	let artists = [ ], watch = [ ], layers;
	function init() {
		if ( !prefs ) prefs = JSON.parse(storage('eabPrefs'));
		prefs.sites = prefs.sites || [ ];  // backward compatibility: pre-2.0
		
		if ( prefs.time ) {
			// backward compatibility: pre-1.4
			if ( !Array.isArray(prefs.time) ) prefs.time = [ prefs.time, prefs.time ];
			
			lastSaved -= prefs.time[0];
			lastVisit -= prefs.time[1];
			
			cooldown = !exp(prefs.time[0], timeout.cache);
			if ( !cooldown ) lastVisit = lastSaved;
			
		} else {
			prefs.time = [ now(), now() ];
			cooldown = false;
		}

		// refresh when preferences are changed within the current window
		window.addEventListener('storage', event => {
			if (event.key.substr(0,3) === 'eab' && event.oldValue !== null) eabRefresh();
		});

		// backward compatibility
		if ( Array.isArray(prefs.watchlist) && !prefs.cache ) prefs.cache = {};  // pre-1.1
		if ( typeof prefs.watchlist === 'string' ) prefs.watchlist = JSON.parse(prefs.watchlist);  // pre-1.2?
		if ( prefs.cache ) {  // pre-1.4
			prefs.watchlist = assembleCache(prefs.watchlist, prefs.cache);
			delete prefs.cache;
		}
		
		watch = assembleWatch(prefs.watchlist);
		black = prefs.blacklist;
		sites = prefs.sites;
		
		if ( watch.length >= 400 ) eabCap();
		
		if ( roles.includes('galleryTag') || roles.includes('galleryWiki') ) initGallery();
		if ( roles.includes('search') ) initSearch();
		if ( roles.includes('watchlist') ) initWatchlist();
		if ( roles.includes('artistTags') ) initArtistTags();
		if ( roles.includes('favlist') ) initFavlist();
		if ( roles.includes('config') ) initConfig();
		if ( roles.includes('help') ) initHelp();
	}
	
	
	let timeLayers = [ 'none', 'alias', 'black' ];
	function initLayout(parts) {
		sidebar.appendChild( n.frag({ desc: parts.map( part => (typeof layout[part] === 'function') ? layout[part]() : layout[part] ) }) );
		
		layers = [   ...layers,
			{ id: 'black', desc: `Blacklisted` },
			{ id: 'alias', desc: `Can't identify artist`, append: help.span(`Possible causes:\n •  this is an alias\n •  name contains illegal characters\n •  tag type isn't "artist" and should be corrected`) },
			{ id: 'none', desc: `No posts found`, append: help.span(`Possible causes:\n •  artist has gone DNP\n •  tag has been replaced, but an alias was not set up\n •  on e926 and no posts exist`) },
			{ id: 'waiting', desc: 'Waiting' }
		];
		
		populateGallery();
	}
	
	function populateGallery() {
		layers.forEach(layer => {
			gallery.appendChild(n.div({ class: 'eabLayer', id: `eabLayer${layer.id ? layer.id : layers.indexOf(layer)}`, onclick: eggLetter, desc:
				n.div({ html: layer.desc, ...layer.append && { desc: layer.append } })
			}) );
		});
		gallery.appendChild(n.div({ class: 'Clear' }));
		posts = gallery.childNodes;
	}
	
	
	function initArtistTags() {
		for (let i = 0; i < artistTags.length; i++) {
			let atDesc = artistTags[i].children;
			let artist = atDesc[atDesc.length - 2].innerHTML.replace(/ /g, '_');
			if (!notArtists.includes(artist)) artistTags[i].appendChild(eabHeart(artist, `tagList`));
		}
	}
	
	function initConfig() {
		let overwrite = { 'eabBlCont': config.blacklist(), 'eabEsConfigCont': config.external(), 'eabEsCont': layout.sites(true) };
		for ( let part in overwrite ) {
			getId(part).innerHTML = '';
			getId(part).appendChild(overwrite[part]);
		}
		log.set('action', 'Ready.');
	}
	
	function initHelp() {
		log.set('action', 'Ready.');
	}
	
	
	//}
	// - - pre-init          //{
	function prepContent(frag) {
		content.innerHTML = '';
		content.appendChild(frag);
	}
	
	let lineArtists;
	if ( roles.includes('gallery') || roles.includes('watchlist') ) {
		let frag = eabLayout();
		
		if ( roles.includes('galleryTag') || roles.includes('galleryWiki') ) prepGallery();
		if ( paginator ) frag.appendChild(paginator);
		
		prepContent(frag);
	}
	
	if ( roles.includes('wiki') ) wikiHtml();
	if ( roles.includes('help') ) prepContent( wikiTemplate( 'help', ['tips', 'interface', 'galleries', 'cache', 'restoration'] ) );
	if ( roles.includes('config') ) prepContent( wikiTemplate( 'config', ['blacklist', 'external'] ) );
	if ( !loggedIn ) quit('Error: not logged in.');
	
	
	//}
	// - - watchlist         //{
	async function initWatchlist() {
		artists = [ ...watch ];
		
		layers = [
			{ time: lastVisit, desc: 'Since last visit' },
			{ time: 60*60*24*7, desc: 'Past week' },
			{ time: 60*60*24*30, desc: 'Past month' },
			{ time: 60*60*24*365, desc: 'Past year' },
			{ time: Infinity, desc: 'Older than a year' },
		].filter( layer => layer.id || (layer.time >= lastVisit) );
		
		initLayout( ['manage', 'sites', 'misc'] );
		if (cooldown) ncLog = (storage('eabNcLog')) ? JSON.parse(storage('eabNcLog')) : { };
		
		if ( watch.length === 0 ) log.ready();
		else watch.forEach(artist => {
			if ( ( storage('eabInvalidateCache') && storage('eabInvalidateCache') > prefs.time[0] )
				|| !prefs.watchlist[artist].i )   placeholder(artist);
			else {
				let info = { min: prefs.watchlist[artist] };
				
				if ( Array.isArray(info.min.t) ) info.min.t = info.min.t[0];  // backwards compatibility: pre-1.4
				info = { ...info };
				
				if ( cooldown && (!isNew(info.min.t) || ncLog[artist]) ) artists.splice(artists.indexOf(artist), 1);   // don't update
				else info.itemClass = 'eabFade';   // do update
				
				placeItem( info.min.t, artist, info );
				if ( cooldown && isNew(info.min.t) && ncLog[artist] ) ncDisp(artist);
				log.set('action', 'Cached results shown.');
			}
		});
		
		[...artists].reverse().forEach(sanitize);
		if ( artists.length === 0 ) return;
		
		await checkChanges();
		getPosts( tagLim[host], () => {
			if ( ncLog ) storage('eabNcLog', ncLog);
			if ( !cooldown ) prefs.time = [ now(), prefs.time[0] ];
			saveChanges();
		} );
	}
	
	
	//}
	// - - gallery           //{
	function prepGallery() {
		let lineItems, lineList = [ ];
		if ( roles.includes('galleryWiki') ) lineItems = getCss('table td:nth-child(2) a:first-child');
		else if ( roles.includes('galleryTag') ) lineItems = getCss('.tag-type-artist a');
		
		layout.search = layout.search();
		
		lineItems.forEach(item => lineList.push(item.textContent));
		lineArtists = lineList.filter( item => !notArtists.includes(item) && item.length > 0 );
	}
	
	
	let galleryCache = { };
	let initGalleryItem = (artist, info, resolve, counter) => {
		if ( info ) {
			if ( info.swf && !checkBl(info.swf) ) swfRecord[artist] = info.swf;
			galleryCache[artist] = info;
			
			// keep for 4x initial age of the post or 1 day, whichever is larger
			let expCond = [ timeout.gallery, ...(info.min.t > 5) ? [(info.stored - info.min.t)*4/60] : [] ];
			let invalidate = (info.min.t === timeLayers.indexOf('black')) && (storage('eabInvalidateCache') || 0) > info.stored;
			let blacklisted = info.min.t > 5 && ( checkBl(info) || (info.swf && checkBl(info.swf)) );
			
			if ( blacklisted || invalidate || exp(info.stored, Math.max(...expCond)) ) info.itemClass = 'eabFade';   // do update
			else artists.splice(artists.indexOf(artist), 1);   // don't update
			
			if ( info.itemClass === 'eabFade' ) placeholder(artist);
			else placeItem( info.min.t, artist, info );
			log.set('action', 'Cached results shown.');
			
		} else placeholder(artist);
		
		counter.n--;
		if ( counter.n === 0 ) resolve();
	};
	
	let handleStore = list => new Promise( resolve => {
		if ( list.length === 0 ) return resolve();
		let counter = { n: list.length };
		
		list.forEach(artist => {
			idbGet(artist).then(info => initGalleryItem(artist, info, resolve, counter));
		});
	});
	
	async function initGallery() {
		artists = [...lineArtists];
		layers = [ { time: 0, desc: 'List' } ];
		
		modPaginator('basis=true');
		initLayout( ['search'] );
		
		[...artists].reverse().forEach(sanitize);
		if (artists.length === 0) log.set('action', 'No results.');
		
		if ( !idb ) await idbPrep();
		await handleStore(artists);
		getPosts( tagLim[host], () => log.done() );
	}
	
	
	//}
	// - - favlist           //{
	let searchTags;
	function initFavlist() {
		searchTags = decodeURIComponent(window.location.href.split('/').pop().split('=').pop());
		if ( !isNaN(searchTags) || searchTags === 'index' || searchTags === 'post' ) searchTags = '';
		
		mode.insertBefore( n.option({ value: 'artist-watchlist', text: 'View artists' }), mode.childNodes[2] );
		if ( storage('eabViewArtists', null, sessionStorage) ) prepFavlist();
		
		mode.onchange = function() {
			if ( this.value === 'artist-watchlist' ) {
				storage('eabViewArtists', 'true', sessionStorage);
				prepFavlist();
			} else {
				if ( storage('eabViewArtists', null, sessionStorage) ) sessionStorage.removeItem('eabViewArtists');
				if ( content.classList.contains('favlist') ) undoFavlist();
				window.PostModeMenu.change();
			}
		};
	}
	
	//}
	// - - search            //{
	let searchPage = 1;
	function initSearch() {
		searchOffsets = { perfect: 0, strong: 500, partial: 10000, alias: 20000 };
		layers = [
			{ time: searchOffsets.partial, desc: 'Complete match' },
			{ time: searchOffsets.alias, desc: 'Partial match' },
			{ time: Infinity, desc: 'Alias match' }
		];
		
		initLayout( ['manage'] );
		if ( !searchFor ) return log.set('action', 'Search for an artist below.');
		
		if ( searchFor.charAt(searchFor.length - 1) === '*' ) searchFor = searchFor.slice(0, -1);
		if ( searchFor.charAt(0) === '*' ) searchFor = searchFor.substr(1);
		
		gallery.dataset.page = searchPage;
		executeSearch();
	}
	
	async function executeSearch() {
		if ( !searchPages[searchPage] ) searchPages[searchPage] = true;
		
		log.set('action', 'Searching...');
		let data1 = await request('GET', '/tag/index.json', [`name=*${searchFor}*`, 'type=1', 'order=date', `page=${searchPage}`]).then(searchResults);
		let data2 = await request('GET', '/artist/index.json', [`name=${searchFor}`, `page=${searchPage}`]).then(searchResults);
		
		let more = Math.max(data1.length, data2.length) === 50;
		if ( searchPage === 1 && !searchProcess[searchFor] && more ) await request('GET', '/tag/index.json', [`name=${searchFor}`, 'type=1']).then(searchResults);
		
		if ( data1.length + data2.length === 0 ) return log.set('action', 'No results found.');
		
		gallery.appendChild( prevNext(searchPage, more) );
		domStatus.prevNext = true;
		
		getPosts( tagLim[host], () => {
			log.done();
			searchWaiting = false;
			paginator.classList.remove('eabWaiting');
		} );
	}
	
	async function searchResults(data) {
		let append = [ ], tags = data.map(a => a.name);
		[...tags].reverse().forEach(sanitize);
		
		tags.forEach( name => {
			if ( searchProcess[name] === undefined ) {
				searchProcess[name] = true;
				artists.push(name);
				append.push(name);
			}
		} );
		
		searchFilter( 'perfect', entry => entry === searchFor );
		searchFilter( 'strong', entry => entry.split(/(?:,|_|-|\)|\(|\:)+/).includes(searchFor) );
		searchFilter( 'alias', entry => !entry.includes(searchFor) );
		searchFilter( 'partial', entry => true );
		
		if ( !idb ) await idbPrep();
		await handleStore(append);
		return Promise.resolve(data);
	}
	
	//}
	
	// - Formation - - - - - //{
	let checkBl = info => Object.keys(prefs.blacklist).some(blTags => {
		let tags = info.tags.split(' ');
		
		if ( !prefs.blacklist[blTags].includes(info.rating) ) return false;
		else return blTags.split(' ').every(tag => {
			if ( tag.charAt(0) === '-' ) return ( !tags.includes(tag.substr(1)) );
			else return ( tags.includes(tag) );
		});
	});
	
	
	//}
	// - - data search       //{
	let permit = { }, find;
	let postTime = (artist) => {
		if ( roles.includes('watchlist') && prefs.watchlist[artist] ) return prefs.watchlist[artist].t;
		else if ( roles.includes('gallery') && galleryCache[artist] ) return galleryCache[artist].min.t;
	};
	
	let sanitize = artist => {
		if ( forbidden.start.includes(artist.charAt(0)) || forbidden.any.some(ch => artist.includes(ch)) ) missingItem('alias', artist);
	};
	
	let eabGet = new CustomEvent('eabGet');
	function getPosts(lim = tagLim[host], callback = false) {
		if ( callback ) document.addEventListener('eabGet', callback);
		if ( artists.length === 0 ) return document.dispatchEvent(eabGet);
		
		if ( domStatus.slow || (perf.req > 0 && perf.time/perf.req > slow.simplify) ) lim = slowMode();
		if ( roles.includes('gallery') && lim === tagLim[host] ) lim--;   // make room for favcount
		find = [ ];
		
		for ( s = 0; s < artists.length && s < lim; s++ ) {
			let time = postTime(artists[s]);
			let none = ( time === timeLayers.indexOf('none') );
			
			// alert - search multiple (none) at once
			let exhausted = ( permit[artists[s]] && permit[artists[s]] >= 2 );   // each tag is permitted 2 searches - afterwards, try searching it alone
			let old = ( time > 5 && roles.includes('watchlist') && exp(time, timeout.multisearch) );   // same if post is very old
			let alias = ( time === timeLayers.indexOf('alias') );   // same if artist is an alias
			
			if ( exhausted || old || alias || none ) {
				if ( find.length > 0 ) continue;
				find.push( artists[s] );
				s = 1;
				break;
			}
			
			find.push(artists[s]);
			if (permit[artists[s]]) permit[artists[s]]++;
			else permit[artists[s]] = 1;
		}
		
		let tags = find.join(' ~');
		if ( roles.includes('gallery') ) tags += ' order:favcount';
		if ( find.length > 1 ) tags = `~${tags}&limit=${s*ppa}`;   // limit slows search down w/ 1 tag
		
		pLim = lim;
		if ( roles.includes('dev') ) console.log('Searching: ', find);
		request('GET', '/post/index.json', [`tags=${tags}`]).then(createGallery, quitReq);
		log.set('action', 'Requesting posts...');
	}
	
	
	//}
	// - - data handling     //{
	let retryCounter = 0, blRecord = { }, swfRecord = { }, pLim, s, ncList, p, d;
	async function galleryItem(item, last) {
		let artist, f = find.findIndex(name => item.artist.includes(name));
		if ( f > -1 ) artist = find[f];
		let info = distillItem(item, artist);
		
		// if another artist matches this post, run it again
		if ( find.some( name => (name !== artist) && item.artist.includes(name) ) ) d--;
		// stop if artists processed === artists searched
		if ( p >= s && (!isNew(info.min.t) || roles.includes('gallery')) ) return d = 500;
		
		if ( checkBl(info) ) {
			if ( !blRecord[artist] ) blRecord[artist] = [ info.min.i[2] ];
			else if ( !blRecord[artist].includes(info.min.i[2]) ) blRecord[artist].push(info.min.i[2]);
			return;
		}
		
		if ( artist ) {
			if ( roles.includes('gallery') && info.min.flash ) return swfRecord[artist] = swfRecord[artist] || info;
			
			p++;
			find.splice(f, 1);
			presentItem(info, artist);
		}
		
		// display/update counter for new posts
		if ( isNew(info.min.t) && roles.includes('watchlist') ) {
			info.artistTags.forEach(artist => {
				if ( notArtists.includes(artist) ) return;
				if ( !ncList.includes(artist) ) ncList.push(artist);
				
				ncUpdate(artist, info);
			});
			
			// if too many new posts - display '+' for all
			if ( last ) ncList.forEach( name => ncUpdate(name, '+') );
		}
	}
	
	function createGallery(data) {
		p = 0;
		retryCounter--;
		
		ncList = [];   // record in case we must add '+' to nc
		for ( d = 0; d < data.length; d++ ) galleryItem( data[d], ( d === data.length - 1 ) );
		
		if ( data.length === 0 ) {   // nothing found
			missingItem('none', find[0]);
			
		} else if ( p === 0 ) {   // something found, but nothing processed
			if ( s > 1 ) retryCounter = pLim;   // try again, 1 at a time, for all parts of input
			else if ( roles.includes('gallery') && swfRecord[find[0]] ) presentItem(swfRecord[find[0]], find[0]);
			else if ( blRecord[find[0]] ) missingItem('black', find[0]);
			else missingItem('alias', find[0]);
		}
		
		getPosts( (retryCounter > 0) ? 1 : tagLim[host] );
	}
	
	
	//}
	// - - item construct    //{
	function distillItem(item, artist) {   // reduce size of item for storage
		let info = {
			artist,  artistTags : item.artist,
			stored: now(),  min : {
				i : [ item.preview_width, item.preview_height, item.md5 ],
				t : item.created_at.s
			}
		};
		
		if (item.file_ext === 'swf') info.min.flash = true;
		['tags', 'rating', 'score', 'fav_count', 'id'].forEach( prop => info[prop] = item[prop] );
		
		return info;
	}
	

	let newItemLinks = (artist, href, heart) => [
		heart,  n.a({ class: 'eabWiki', href: `/artist/show?name=${artist}`, text: '?' }),
		n.a({ href, desc: n.span({ text: artist.replace(/_/g, ' '), title: artist }) }),
	];
	
	let months = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
	let imHost = `${window.location.protocol}//static1.${window.location.host}/`;
	function newItem(artist, info) {
		let imSrc, md5 = info.min.i[2] || false;
		
		if ( !md5 ) imSrc = '';
		else if ( md5.length === 32 ) {
			if ( blRecord[artist] && blRecord[artist].includes(md5) ) imSrc = '/images/blacklisted-preview.png';
			else if ( info.min.flash ) imSrc = 'images/download-preview.png';
			else imSrc = `data/preview/${md5.substring(0,2)}/${md5.substring(2,4)}/${md5}.jpg`;
		
		// backward compatibility: pre-1.4
		} else if ( md5.includes('download-preview.png') ) {
			imSrc = 'images/download-preview.png';
			md5 = false;
		} else if ( md5.includes('/') ) {
			imSrc = `data/preview/${md5}`;
			md5 = md5.split('/').pop().replace('.jpg', '');
		}
		
		let href = `/post?tags=${artist}`;
		if ( roles.includes('gallery') ) href += ` order:favcount`;
		
		let alt = '';
		if ( info.tags ) alt = `${info.tags} \n\nArtist tags: ${info.artistTags.join(', ')} \nRating: ${{'s':'Safe','q':'Questionable','e':'Explicit'}[info.rating]} \nScore: ${info.score} \nFaves: ${info.fav_count}`;
		
		let dText = false;
		if ( info.min.t > 5 && roles.includes('watchlist') ) {
			let date = new Date(info.min.t*1000);
			dText = [ n.text(`${('0' + date.getDate()).slice(-2)} ${months[date.getMonth()]} `), n.span({ class: 'eabFade', text: date.getFullYear() }) ];
		}
		
		let dims = ( blRecord[artist] && blRecord[artist].includes(md5) ) ? dInfo.min.i : info.min.i;
		let heart = ( info.min.t < 5 && !watch.includes(artist) ) ? false : eabHeart(artist, 'heart');
		
		return n.span({ id: info.itemId || `ab-${artist}`, class: `thumb ${info.itemClass || ''}`, 'data-time': info.min.t, desc:
			n.span({ style: `width: ${pWidth(dims[0])}`, desc: [
				swfRecord[artist] && !info.min.flash && n.a({ href: `/post/show?md5=${swfRecord[artist].min.i[2]}`, class: 'eabSwfNotice', text: 'swf' }),
				n.a({ ...md5 && { href: `/post/show?md5=${md5}` }, desc: [
					n.img({ class: 'preview', alt, title: alt, width: `${dims[0]}px`, height: `${dims[1]}px`,
						...( !roles.includes('noImage') && imSrc ) && { src: imHost + imSrc } })
				] }),
				
				n.span({ class: 'post-score eabArtist', desc: [
					!( info.itemClass && info.itemClass === 'slave' ) && newItemLinks( artist, href, heart ),
					dText && n.a({ href, class: 'post-date', desc: dText })
				].flat() })
			] })
		});
	}
	
	function placeholder(artist) {
		getId(`eabLayerwaiting`).style.display = 'block';
		gallery.insertBefore( newItem(artist, dInfo), gallery.lastElementChild );
	}
	
	
	//}
	// - - placement         //{
	function normalSort(t) {
		order.push(t);
		order.sort( (a, b) => a - b );
		return order.filter( a => a > 5 ).indexOf(t);
	}
	
	function revSort(t) {
		order.push(t);
		order.sort( (a, b) => a - b ).reverse();
		return order.indexOf(t);
	}
	
	let ncOffset = { }, order = [ ];
	function placeItem(time, artist, info) {
		let place, offset = 0;
		
		if ( roles.includes('watchlist') || time < 5 ) place = revSort(time);
		else if ( roles.includes('galleryTag') || roles.includes('galleryWiki') ) place = normalSort(lineArtists.indexOf(artist) + 10);
		else if ( roles.includes('search') ) {
			time = searchIndex[artist];
			place = normalSort(time);
		}
		
		sorted.splice(place, 0, artist);
		for (let i = 0; i < place; i++) offset += ncOffset[sorted[i]] || 0;
		
		let layer = timeLayers[time] || 0;
		if ( !roles.includes('search') && time > 5 ) time = now() - time;
		if ( !layer ) layers.forEach(a => { if (a.time && time > a.time) layer++; });
		
		getId(`eabLayer${layer}`).style.display = 'block';
		
		if ( time < 5 ) layer = layers.map(l => l.id).indexOf(layer);
		gallery.insertBefore( newItem(artist, info), posts[place + layer + offset + 1] );
	}
	
	
	let dInfo = { min: { i: [150, 80], t: 0 } };
	function missingItem(t, artist) {
		t = timeLayers.indexOf(t);
		let min = { ...dInfo.min, t };
		
		removeItem(artist);
		placeItem(t, artist, dInfo);
		
		if ( roles.includes('gallery') ) idbPut({ min, artist, stored: now() });
		if ( roles.includes('watchlist') ) prefs.watchlist[artist] = min;
	}
	
	function presentItem(info, artist) {
		removeItem(artist);
		placeItem(info.min.t, artist, info);
		
		if ( roles.includes('gallery') || roles.includes('search') ) idbPut({ ...info, ...swfRecord[artist] && { swf: swfRecord[artist] } });
		if ( roles.includes('watchlist') ) prefs.watchlist[artist] = info.min;
	}
	
	function removeItem(artist) {  // check not involved with gallery
		if ( artists.includes(artist) ) artists.splice(artists.indexOf(artist), 1);
		
		let prior = sorted.indexOf(artist);
		if ( prior > -1 ) {
			sorted.splice(prior, 1);
			order.splice(prior, 1);
		}
		
		let existing = getId(`ab-${artist}`);
		if ( existing ) {   // alert - optimize this
			// if we're surrounded by layer divs, this is the last item in the layer and it can be hidden
			let last = ![existing.nextElementSibling.tagName, existing.previousElementSibling.tagName].includes('SPAN');
			if (last) existing.previousElementSibling.style.display = 'none';
			
			existing.remove();
		}
	}
	
	
	//}
	// - - new counter       //{
	let ncLog = {};
	function ncUpdate(artist, add) {
		if (!ncLog[artist]) ncLog[artist] = { master: add.id };
		
		if ( typeof add === 'string' ) ncLog[artist].append = add;
		else {   // guard against the possibility of collabs being counted twice
			if ( Object.keys(ncLog[artist]).includes(add.id) ) return;
			ncLog[artist][add.id] = add;
		}
		
		ncDisp(artist);
	}
	
	function ncDisp(artist) {
		if (!ncOffset[artist]) ncOffset[artist] = 0;
		
		let ab = getId(`ab-${artist}`);
		if (ab) ab = ab.firstElementChild;
		else return;
		
		let nc = getId(`nc-${artist}`);
		let ncValue = Object.keys(ncLog[artist]).filter(key => !isNaN(key)).length;
		if (ncLog[artist].append) ncValue = `${ncValue}+`;
		
		if (nc) nc.innerHTML = ncValue;
		else {
			nc = n.div({ id: `nc-${artist}`, class: 'newCounter', html: ncValue });
			ab.insertBefore(nc, ab.firstChild);
		}
		
		if (!nc.onclick && (ncLog[artist].append || ncValue > 1)) {
			nc.classList.add('expand');
			
			nc.onclick = function() {
				let expanded = getClass('collapse');
				if (expanded.length > 0 && nc.classList.contains('expand')) toggleMaster(expanded[0], expanded[0].id.substring(3));
				
				toggleMaster(nc, artist);
				if (ncLog[artist].append) fullSearch(artist, 1);
			};
		}
	}
	
	document.addEventListener('click', e => {
		let expanded = getClass('collapse');
		if (expanded.length > 0 && event.target.closest('.slave') === null) toggleMaster(expanded[0], expanded[0].id.substring(3));
	});
	
	function toggleMaster(nc, artist) {
		['expand', 'collapse'].forEach( a => nc.classList.toggle(a) );
		postList.classList.toggle('highlight');
		ncToggle(artist);
	}
	
	function ncItem(artist, id, insertPoint) {
		let info = ncLog[artist][id];
		
		info.itemClass = 'slave';
		info.itemId = `abs-${id}`;
		
		let elem = newItem(artist, info);
		gallery.insertBefore(elem, insertPoint);
		ncOffset[artist]++;
		
		return elem;
	}
	
	function ncToggle(artist, state) {
		let ab = getId(`ab-${artist}`);
		let expanded = state || ab.classList.toggle('slave');
		
		let insertPoint;
		if (state) insertPoint = posts[ Array.prototype.indexOf.call(posts, ab) + ncOffset[artist] + 1 ];
		else insertPoint = ab.nextElementSibling;
		
		Object.keys(ncLog[artist]).reverse().forEach(id => {
			if (id == ncLog[artist].master || isNaN(id)) return;
			
			let elem = getId(`abs-${id}`) || ncItem(artist, id, insertPoint);
			if (expanded) elem.style.display = '';
			else elem.style.display = 'none';
		});
	}
	
	async function fullSearch(artist, page) {
		let data = await request('GET', '/post/index.json', [`tags=${artist}`, `page=${page}`]).catch(quitReq);
		let clear = true;
		
		data.forEach(item => {
			let info = distillItem(item, artist);
			
			// display all new posts
			if ( !isNew(info.min.t) || ncLog[artist][info.id] ) return;
			
			ncUpdate(artist, info);
			
			// if too many new posts - continue searching
			if ( data.indexOf(item) === data.length - 1 ) {
				fullSearch(artist, page + 1);
				clear = false;
			}
		} );
		
		if (clear) {  // finished
			ncUpdate(artist, '');  // clear append
			if (cooldown) storage('eabNcLog', ncLog);
		}
		ncToggle(artist, true);
	}
	
	
	//}
	// - - favlist           //{
	function prepFavlist() {
		mode.value = 'view'; window.PostModeMenu.change(); mode.value = 'artist-watchlist'; // reset
		
		if ( content.classList.contains('undoFavlist') ) {
			content.classList.replace('undoFavlist', 'favlist');
			content.classList.add('eab');
			let posts = getClass('thumb');
			for (let post of posts) {
				post.lastElementChild.style.display = '';
				post.children[post.children.length - 2].style.display = 'none';
			}
			
		} else {
			let page = paginator.getElementsByClassName('current')[0];
			page = (page) ? page.innerHTML : '1';
			
			request('GET', '/post/index.json', [`tags=${searchTags}`, `page=${page}`]).then(favlist, quitReq);
		}
	}

	function favlist(data) {
		['eab', 'favlist'].forEach( a => content.classList.add(a) );
		postList = getId('post-list');
		
		data.forEach(item => {
			let postCont = getId(`p${item.id}`);
			if (!postCont) return;
			
			postCont.onclick = '';
			let post = postCont.firstChild;

			postCont.lastChild.style.display = 'none';
			post.style.width = pWidth(item.preview_width);

			let list = item.artist.filter( tag => !notArtists.includes(tag) );
			let links = n.span({ class: 'post-score eabArtist', style: `min-width: ${pWidth(item.preview_width)}`, desc: list.map(
				artist => n.frag({ desc: newItemLinks(artist, `/post?tags=${artist}`, eabHeart(artist, item.id)) })
			) });
			if ( list.length === 0 ) links.appendChild(n.span({ class: 'eabGray', text: 'unknown' }));
			postCont.appendChild(links);

		});
	}
	
	function undoFavlist() {
		content.classList.replace('favlist', 'undoFavlist');
		content.classList.remove('eab');
		let posts = getClass('thumb');
		for (let post of posts) {
			post.lastElementChild.style.display = 'none';
			post.children[post.children.length - 2].style.display = 'block';
		}
	}
	
	//}
	// - - search            //{
	let searchPages = [ false ], searchWaiting = true;
	function switchSearchPage(page) {
		if ( searchWaiting ) return;
		searchPage = page;
		searchPages[gallery.dataset.page] = gallery;
		postList.removeChild(gallery);
		
		if ( searchPages[page] ) {
			gallery = searchPages[page];
			let repl = getCss('#paginator', gallery)[0];
			repl.parentNode.replaceChild( prevNext(page, searchPages[page+1]), repl );
		} else gallery = n.div({ class: 'content-post', 'data-page': searchPage });
		
		postList.appendChild(gallery);
		if ( searchPages[page] ) return;
		
		domStatus.prevNext = false;
		populateGallery();
		artists = [ ];  order = [ ];
		executeSearch();
	}
	
	let searchPageLinks = curr => searchPages.map( (elem, page) => {
		if ( elem ) return n.frag({ desc: [
			(page === curr) && n.span({ class: 'current', text: page }),
			(page !== curr) && n.a({ text: page, rel: (page > curr) ? 'next' : 'prev', onclick: () => switchSearchPage(page) }),
			n.text(' ')
		] })
	} );
	
	let prevNext = (curr, more) => {
		let prev = { class: `prev_page ${ curr > 1 ? '' : 'disabled' }`, text: '« Previous', ...(curr > 1) && { onclick: () => switchSearchPage(curr - 1) } };
		let next = { class: `next_page ${ more ? '' : 'disabled' }`, text: 'Next »', ...more && { onclick: () => switchSearchPage(curr + 1) } };
		
		prev = ( curr > 1 ) ? n.a(prev) : n.span(prev);
		next = ( more ) ? n.a(next) : n.span(next);
		
		paginator = n.div({ id: 'paginator', ...searchWaiting && { class: 'eabWaiting' }, desc: [ prev, n.text(' '), ...searchPageLinks(curr), next ] });
		return paginator;
	};
	
	let searchIndex = { }, searchProcess = { }, searchOffsets;
	function searchFilter(tier, filter) {
		let list = Object.keys(searchProcess);
		for ( let i = 0; i < list.length; i++ ) {
			let entry = list[i];
			if ( searchProcess[entry] === false || !filter(entry) ) continue;
			searchProcess[entry] = false;
			
			searchIndex[entry] = searchOffsets[tier] + i + 10;
		}
	}
	
	//}
	
	// - Data  - - - - - - - //{
	function assembleCache(list, temp) {
		let cache = { }, counter = 0;
		
		list.forEach(artist => {
			if ( temp[artist] ) cache[artist] = { ...temp[artist] };
			else cache[artist] = { };
			
			if ( !isNaN(artist) ) cache[artist].n = counter;
			counter++;
		});
		
		return cache;
	}
	
	function assembleWatch(obj) {
		let arr = [ ], counter = 0;
		
		Reflect.ownKeys(obj).forEach(name => {
			let place;
			while ( arr[counter] ) counter++;
			
			if ( !isNaN(name) ) place = obj[name].n;
			else place = counter;
			
			arr[place] = name;
		});
		
		return arr;
	}
	
	
	//}
	// - - hearts            //{
	let purge = [ ], sorted = [ ], prefs, directory = { };
	let heartClass = artist => {
		let fav = watch.includes(artist) && !purge.includes(artist);
		return fav ? 'eabHeart eabFav' : 'eabHeart';
	};
	
	function eabHeart(artist, id) {
		if ( directory[artist] ) directory[artist].push(`${id}_${artist}`);
		else directory[artist] = [ `${id}_${artist}` ];

		return n.span({ id: `${id}_${artist}`, onclick: heartToggle, class: heartClass(artist), 'data-artist': artist, text: '♥ ' });
	}
	
	function eabCap() {
		content.classList.add('eabCap');
		if ( !roles.includes('wiki') ) log.notice('Watchlist cap of 400 reached.');
	}
	
	function heartToggle() {
		let artist = event.target.getAttribute('data-artist');
		let existing = watch.includes(artist);
		
		if ( artist === 'eabExample' ) return event.target.classList.toggle('eabFav');
		if ( watch.length >= 400 && !existing ) return;
		
		if ( existing ) watch.splice(watch.indexOf(artist), 1);
		else watch.splice(0, 0, artist);
		
		if ( watch.length >= 400 && !content.classList.contains('eabCap') ) eabCap();
		if ( watch.length < 400 && content.classList.contains('eabCap') ) content.classList.remove('eabCap');
		
		// if it's already been rendered and sorted, leave it alone for now, but don't save it later
		if ( purge.includes(artist) ) purge.splice(purge.indexOf(artist), 1);
		else if ( roles.includes('watchlist') && sorted.includes(artist) ) purge.splice(0, 0, artist);
		
		directory[artist].forEach(id => { getId(id).className = heartClass(artist) + ' eabFade'; });
		
		saveChanges().then( () => {
			directory[artist].forEach(id => {
				getId(id).className = heartClass(artist);
			} );
		});
	}
	
	//}
	// - - comms             //{
	let setDesc = () => 'This private set contains your configuration of the \nArtist Basis script. It is used so your list can be\npermanently stored between sessions. If this set\nis tampered with, the script may malfunction.\n\n' + LZString.compressToUTF16(JSON.stringify(prefs));
	
	function slowMode() {
		if ( domStatus.slow ) return 1;
		
		domStatus.slow = true;
		log.notice('Slow server response - trying simpler searches.', 'slowMode');
		return 1;
	}
	
	let perf = {
		req: 0,
		time: 0
	};
	
	let quitReq = page => quit(`Server error: ${page.status} on ${page.responseURL}`);
	let reqLog = { }, lastReq = 0, slowTimeout, agent = `Artist_Basis/${GM.info.script.version} (by index on e621)`;
	console.log('User agent: ', agent);
	async function request(method, url, data = []) {
		let limited = url.includes('/post/index.json');
		
		// rate limiting
		let wait = 500 - (Date.now() - lastReq);
		if ( wait > 0 ) await timer(wait);
		lastReq = Date.now();
		
		
		let form;
		if ( Array.isArray(data) ) {
			form = null;
			data.push(`_client=${agent}`);
			url += '?' + data.join('&');
		} else {
			form = new FormData();
			url += `?_client=${agent}`;
			for (let part in data) form.append(part, data[part]);
		}
		
		if ( limited ) {   // alert - extend this
			if ( reqLog[url] ) quit(`Error: loop detected on query '${url}'`);
			reqLog[url] = true;
		}
		
		
		// performance monitor
		let t = Date.now();
		slowTimeout = setTimeout( () => log.notice('Slow server response, please wait...', 'waitSlow'), slow.warn);
		
		let result = await new Promise( function(resolve, reject) {
			let page = new XMLHttpRequest();
			xhr.push(page);
			page.onreadystatechange = function() {
				if ( page.readyState !== 4 ||  page.status === 0) return;
				if ( page.status >= 200 && page.status < 300 ) resolve(page.response);
				else reject(page);
			};
			
			page.open(method, encodeURI(window.location.origin + url), true);
			page.responseType = 'json';
			
			page.send(form);
		});
		
		if ( slowTimeout ) clearTimeout(slowTimeout);
		log.clear('waitSlow');
		
		if ( limited ) {
			perf.time += Date.now() - t;
			perf.req++;
		}
		
		return result;
	}
	
	function eabRefresh() {
		if ( roles.includes('artistTags') ) {
			prefs = JSON.parse(storage('eabPrefs'));
			
			if (prefs) {
				artists = prefs.watchlist;
				let hearts = getClass('eabHeart');
				for (let heart of hearts) heart.className = heartClass(heart.getAttribute('data-artist'));
				return;
			}
		}

		window.addEventListener('focus', () => { location.reload(); });
		if (document.hasFocus()) location.reload();
		quit('Reloading');
	}
	
	async function checkChanges() {
		if ( exp(storage('eabTime'), timeout.storage) ) {
			let eabPrefs = await getPrefs('Checking for changes...').then(handlePrefs);
			if ( eabPrefs.time[0] > prefs.time[0] ) return readyPrefs(eabPrefs).then(eabRefresh);
		}
		
		return Promise.resolve();
	}
	
	async function saveChanges() {
		log.set('action', 'Saving watchlist...');
		
		let set = watch;
		if ( roles.includes('watchlist') ) set = [ ...new Set([...sorted, ...watch]) ];
		
		// combine sorted and artists, remove duplicates and unfavorited
		let list = set.filter( artist => !purge.includes(artist) );
		prefs.watchlist = assembleCache(list, prefs.watchlist);
		prefs.site = host;
		
		let compressed = setDesc();
		if ( compressed.length >= 9990 ) return log.notice(`Onsite storage limit exceeded: ${compressed.length}/9990`);
		await checkChanges();
		
		await request('POST', '/set/update.json', { 'set[description]': compressed, 'set[id]': storage('eabSetId') }).catch(quitReq);
		storage('eabPrefs', prefs);
		storage('eabTime', now());
		
		log.done();
		return Promise.resolve();
	}
	
	
	//}
	// - - storage           //{
	function storage(key, val, obj = localStorage) {
		let curr = obj.getItem(key);
		
		if ( !val ) return curr;
		if ( typeof val === 'object' ) val = JSON.stringify(val);
		if ( val === curr ) return;
		
		obj.setItem(key, val);
		if ( roles.includes('dev') ) console.log(`Storage: ${key} = ${val}`);
	}
	
	function clearStorage() {
		Object.keys(localStorage).forEach(key => {
			if ( key.substr(0,3) === 'eab' && key !== 'eabInvalidateCache' ) localStorage.removeItem(key);
		});
		log.set('action', 'State cleared.');
	}
	
	
	async function clearIdb() {
		let verify = getId('eabClearVerify');
		await idbPrep();
		
		let count = await new Promise( resolve => {
			let req = idb.transaction('items').objectStore('items').count();
			req.onsuccess = () => resolve( req.result );
			req.onerror = () => resolve( '???' );
		});
		
		getCss('span', verify)[0].innerText = count;
		verify.style.display = 'block';
		
		getCss('a', verify)[0].onclick = () => {
			indexedDB.deleteDatabase('eabGallery');
			verify.style.display = 'none';
			log.set('action', 'IndexedDB cleared.');
		};
	}
	
	let store, idbGet = get => new Promise( function(resolve, reject) {
		if ( !idb ) return resolve();
		let req;
		
		try {   // transaction might be dead, have to test
			req = store.get(get);
		} catch(e) {
			store = idb.transaction('items', 'readonly').objectStore('items');
			req = store.get(get);
		}
		
		req.onsuccess = event => resolve(req.result);
	});
	
	let idbPut = put => new Promise( function(resolve, reject) {
		if ( !idb ) resolve();
		else resolve( idb.transaction('items', 'readwrite').objectStore('items').put(put) );
	});
	
	let idb = false, idbReq, idbPromise = false;
	function idbPrep() {
		if ( !idbPromise ) idbPromise = new Promise( function(resolve, reject) {
			idbReq = indexedDB.open('eabGallery', 1);
			idbReq.onupgradeneeded = event => { let store = idbReq.result.createObjectStore('items', { keyPath: 'artist' }); };
			idbReq.onupgradeneeded = event => {
				idbReq.result.createObjectStore('items', { keyPath: 'artist' });
			//	store.createIndex('by_artist', 'artist', { unique: true });
			};
			idbReq.onerror = event => resolve( log.notice('Cache failed, likely a Firefox private browsing bug.') );
			
			idbReq.onsuccess = event => {
				idb = idbReq.result;
				idb.onerror = event => quit(`indexedDB error: ${event.target.error}`);
				resolve();
			};
		});
		
		return idbPromise;
	}
	
	
	function backup() {
		if ( loggedIn ) getPrefs('Retrieving backup...').then( set => {
			saveFile(set.description);
			log.set('action', 'Backup retrieved.');
		} );
	}
	
	function saveFile(data) {
		let blob = new Blob( [data], { type: 'text/plain;charset=utf-8' } );
		let link = window.URL.createObjectURL(blob);
		
		let a = n.a({ style: 'display:none', href: link, download: `${host.split('.')[0]}_basis_backup_${storage('eabUserId')} ${new Date().toUTCString().slice(5)}.txt` });
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(link);
	}
	
	
	//}
	// - - startup           //{
	if ( storage('eabUserName') !== cookie.login || storage('eabVersion') !== GM.info.script.version ) clearStorage();
	storage('eabUserName', cookie.login);
	storage('eabVersion', GM.info.script.version);
	
	function retry() {
		clearStorage();
		eabRefresh();
	}
	
	async function getPrefs(action) {
		log.set('action', action);
		let sets;
		
		// if we have the set id, get it directly
		if (storage('eabSetId')) sets = await request('GET', '/set/show.json', [`id=${storage('eabSetId')}`]).catch(retry);
		// else use post ID and refine with user ID
		else {
			if (!storage('eabUserId')) await request('GET', '/user/show.json').then( user => storage('eabUserId', user.id), quitReq );
			sets = await request('GET', '/set/index.json', [`user_id=${storage('eabUserId')}`, 'post_id=65067']).catch(quitReq);
		}   // if the API sent the "private" key, it'd be possible to search with only post_id
		
		// check if it's artist_watchlist
		if ( !Array.isArray(sets) ) sets = [ sets ];
		for (let i = 0; i < sets.length; i++) {
			if ( sets[i].name.includes('artist_watchlist') ) return sets[i];
		}
		
		return Promise.reject();   // nothing found
	}
	
	async function handlePrefs(set) {
		let eabPrefs = set.description.split('\n')[5];
		
		if ( eabPrefs.substr(0,2) !== '{"' ) eabPrefs = LZString.decompressFromUTF16(eabPrefs);  // backward compatibility pre-1.3
		eabPrefs = JSON.parse(eabPrefs);
		
		if ( !eabPrefs.sites ) eabPrefs.sites = [ ];
		if ( !eabPrefs.ver ) {  // backward compatibility pre-2.0
			eabPrefs.ver = storage('eabVersion');
			if ( storage('eabSilent') ) return;
			
			alert('Artist Watchlist has been upgraded to Artist Basis.\n\nYou will be prompted to save a backup of your watchlist\nso it can be restored if something goes wrong.');
			storage('eabSilent', 'true');
			saveFile(set.description);
		}
		
		if ( !eabPrefs.site || eabPrefs.site !== host ) storage('eabInvalidateCache', now());
		
		storage('eabSetId', set.id);
		return Promise.resolve(eabPrefs);
	}
	
	async function readyPrefs(eabPrefs) {
		prefs = eabPrefs;
		storage('eabTime', now());
		storage('eabPrefs', prefs);
	}
	
	// first-time setup if necessary
	async function firstTime() {
		log.set('action', 'First-time setup...');
		let name = 'artist_watchlist__' + Math.random().toString(36).substr(2, 10);

		let eabPrefs = { 'watchlist': [], 'blacklist': {}, 'time': [ now(), now() ], 'ver': storage('eabVersion'), 'sites': [ ] };
		let create = await request('POST', '/set/create.json', { 'set[name]': name, 'set[shortname]': name, 'set[public]': 'false', 'set[description]': setDesc() }).catch(quitReq);
		
		storage('eabSetId', create.set_id);
		await request('POST', '/set/add_post.json', [`set_id=${storage('eabSetId')}`, 'post_id=65067']).catch(quitReq);
		return Promise.resolve(eabPrefs);
	} 
	
	if ( storage('eabTime') && storage('eabSetId') && storage('eabPrefs') ) init();
	else getPrefs('Requesting user data...').then(handlePrefs, firstTime).then(readyPrefs).then(init);
	//}
	
})();
