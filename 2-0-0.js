// ==UserScript==
// @name         e621 Artist Basis
// @description  Artist-based tools including subscriptions and galleries
// @namespace    https://e621.net/artist/watchlist
// @version      2.0.0
// @author       index
// @license      GPL-3.0-or-later
// @match        *://*.e621.net/*
// @match        *://*.e926.net/*
// @run-at       document-start
// @updateURL    https://openuserjs.org/meta/index-eaw/Artist_Watchlist.meta.js
// @downloadURL  https://openuserjs.org/install/index-eaw/Artist_Watchlist.user.js
// @grant        GM_getResourceURL
// @resource     demo    https://raw.githubusercontent.com/index-eaw/artist-basis/master/img/demo.png
// @resource     logos   https://raw.githubusercontent.com/index-eaw/artist-basis/master/img/logos13.png
// @require      https://raw.githubusercontent.com/pieroxy/lz-string/master/libs/lz-string.min.js
// ==/UserScript==

(async function() {
	
	'use strict';
	
	// - General - - - - - - //{
	let notArtists = [ 'unknown_artist','unknown_artist_signature','unknown_colorist','anonymous_artist','avoid_posting','conditional_dnp','sound_warning','epilepsy_warning' ];
	let forbidden = { 'start': ['-', '~', '+'], 'any': [','] };   // characters that cause problems
	let tagLim = { 'e621.net': 6, 'e926.net': 5 };   // higher-tier accounts can increase these
	let storLim = { 'blacklist': 750, 'sites': 100 };
	let timeout = { 'cache': 90, 'storage': 15, 'gallery': 60*24, 'multisearch': 60*24*365 };   // minimum, in minutes
	let ppa = 8;   // posts per artist - increasing results in larger but fewer server requests
	let roles = [ 'dev' ];
	
	
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
			#navbar li:nth-child(${child})::${pseudo} {
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
		throw new Error(msg);
	}
	
	document.addEventListener('keydown', e => { if (e.keyCode === 27) quit('Halted with Esc key.'); });
	if (Array.prototype.toJSON) delete Array.prototype.toJSON;  // fuck off prototype.js
	
	let now = () => Date.now()/1000;  // alert - freeze at start?
	let lastVisit = now(), lastSaved = now(), cooldown;
	let isNew = t => (t > now() - lastVisit);
	let exp = (time, limit) => ((now() - time)/60 > limit);
	
	let getId = (select, on = document) => on.getElementById(select);
	let getClass = (select, on = document) => on.getElementsByClassName(select);
	let getCss = (select, on = document) => on.querySelectorAll(select);
	
	let timer = wait => new Promise(resolve => setTimeout(resolve, wait));
	let defined = check => check !== undefined;
	let domStatus = { blacklist: false, sites: false };
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
		frag: props => n.elem(document.createDocumentFragment(), props)
	};
	
	['div', 'span', 'a', 'p', 'img', 'style', 'input', 'ul', 'ol', 'li', 'option', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'textarea'].forEach(tag => {
		n[tag] = (props) => n.elem(document.createElement(tag), props);
	});
	
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
	
	let cookie = { };
	document.cookie.split('; ').forEach(crumb => {
		cookie[crumb.split('=')[0]] = crumb.split('=')[1];
	});
	
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
		subnav.appendChild( n.sub('/tag?type=1&order=date&basis=true', 'Gallery (tags)') );
		subnav.appendChild( n.sub('/artist?basis=true', 'Gallery (wikis)') );
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
	if ( path.includes('basis') && path.includes('help') ) roles.push('help');
	if ( path.includes('basis') && path.includes('config') ) roles.push('config');
	if ( artistTags.length > 0 ) roles.push('artistTags');
	if ( mode ) roles.push('favlist');
	
	if ( roles.length === 0 ) return;
	if ( search.includes('dev') ) roles.push('dev');
	
	let titles = { galleryWiki: 'Artist Gallery (wikis)', galleryTag: 'Artist Gallery (tags)', watchlist: 'Artist Watchlist', help: 'Help: Artist Basis', config: 'Configure: Artist Basis' };
	Object.keys(titles).forEach( page => {
		if ( roles.includes(page) ) setTitle(titles[page]);
	} );
	
	//}
	
	// - Content - - - - - - //{
	let sites = [ ], extSites = {
		twitter:        { name: 'Twitter',         url: 'https://twitter.com/home' },
		deviantArt:     { name: 'DeviantArt',      url: 'https://deviantart.com/notifications/#view=watch' },
		furAffinity:    { name: 'Fur Affinity',    url: 'https://furaffinity.net/msg/submissions' },
		patreon:        { name: 'Patreon',         url: 'https://patreon.com/home' },
		pixiv:          { name: 'Pixiv',           url: 'https://pixiv.net/bookmark_new_illust.php' },
		hentaiFoundry:  { name: 'Hentai Foundry',  url: 'https://hentai-foundry.com/users/FaveUsersRecentPictures?enterAgree=1&username=', prompt: ' insert_username_here' },
		newGrounds:     { name: 'NewGrounds',      url: 'https://newgrounds.com/social' },
		tumblr:         { name: 'Tumblr',          url: 'https://tumblr.com/dashboard' },
		weasyl:         { name: 'Weasyl',          url: 'https://weasyl.com/messages/submissions' },
		furryNetwork:   { name: 'FurryNetwork',    url: 'https://furrynetwork.com' },
		inkBunny:       { name: 'Inkbunny',        url: 'https://inkbunny.net/submissionsviewall.php?mode=unreadsubs' },
		soFurry:        { name: 'SoFurry',         url: 'https://sofurry.com/browse/watchlist' },
		fanbox:         { name: 'Pixiv Fanbox',    url: 'https://pixiv.net/fanbox' },
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
	
	let blWidth = 189, pWidthMin = 80, pPadding = 0.6;
	let pWidth = (x) => `calc(${Math.max(x, pWidthMin)}px + ${2*pPadding}ex)`;
	
	let logosData = GM_getResourceURL('logos'), logosStyle = '';
	for (let site in extSites) logosStyle += `.eabExt${site} { background-position: -${extSiteList.indexOf(site)*32}px }`;
	
	style = () => `
		.eab input:disabled { background: #555;
		} .eab { text-shadow: 0 0 3px ${color(2)};
		} .eab:not(.favlist) { display: initial;
		} .eab .sidebar::-webkit-scrollbar { display: none;
		} .eabFade { opacity: 0.5;
		} .eab ol, .eab ol li { margin-left: 0;
		
		} .eab:not(.favlist) .sidebar {
			position: sticky;
			top: 0;
			padding-top: 1ex;
			z-index: 100;
		} .eab .sidebar > div {
			margin: 0 0 1.5em
		} .eab form table {
			width: ${blWidth}px;
			padding: 0;
		} .eab td {
			padding: 0.5px 0;
		} #eabSearch input, #eabSearch select {
			float: right;
			width: 80%;
			margin: 0.5px 0;
			top: 0;
		} #eabSearch input:not([type="submit"]), #eabSearch select {
			right: 1px;
		} #eabSearch select {
			width: calc(80% + 4px);
			padding: 0;
		} #eabSearch input[type="submit"]:hover {
			background: ${hsl(1, 100, -1/10)};
		
		
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
		
		} .eab span.thumb {
			height: inherit;
			margin: 1em 0;
		} .eab span.thumb a {
			box-shadow: none;
		} .eab span.thumb a:first-child {
			display: initial;
		} .eab span.thumb > span {
			position: relative;
			display: block;
			margin: auto;
		} .eab img.preview {
			/*border: 1px solid ${hsl(4)};*/
			border: none;
			border-radius: 4px 4px 0 0;
			background: ${hsl(3)};
			/*border-width: 1px 1px 0 1px;*/
			box-shadow: 0 0 4px ${hsl(4)};
			z-index: 1;
			position: relative;
		} .eab.highlight span.thumb {
			opacity: 0.25;
		} .eab span.thumb.slave {
			opacity: 1;
		
		} .eab .post-score {
			background-color: ${hsl(1)};
			color: ${color(0)};
			border-radius: 0;
			display: block;
			border: 1px solid ${hsl(4)};
			border-width: 1px 1px 0;
			font-size: ${font(10)};
			z-index: 2;
			position: relative;
		} .favlist .eabGray {
			color: ${color(1)};
			cursor: default;
			font-style: italic;
		} .eab .post-score a, .eab .post-score a:hover {
			color: ${color(0)};
			display: block;
			
		
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
		} .eab .thumb:hover .eabFade {
			opacity: 0.7;
		} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki, .eab .thumb a:last-child span {
			padding: 0 0.7ex;
		} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki {
			width: initial;
			border-right: inherit;
		} .eab .expand::before { content: 'expand ';
		} .eab .collapse::before { content: 'collapse ';
		} .eab .thumb:hover .expand::before { width: 7ch;
		} .eab .thumb:hover .collapse::before { width: 9ch;
		
		} .favlist .post-score:last-of-type, .eab .thumb > span > *:last-child {
			border-radius: 0 0 4px 4px;
			border-bottom-width: 1px;
		} .eab .post-date {
			background: ${hsl(2)};
			font-size: ${font(7)};
			line-height: 10pt;
		} .post-date .eabFade {
			padding-left: 0.5ex;
		} .eab .post-score:not(.post-date) {
			line-height: 1rem;
		} .eab .newCounter, .eab .eabSwfNotice {
			position: absolute;
			/*top: -${pPadding}ex; */
			top: calc(-${pPadding}ex - 1px);
			right: 0;
			z-index: 10;
			border-radius: 0 4px;
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
			border-radius: 4px 0;
		
		
		} .eab.wiki img {
			border-radius: 2px;
			margin-left: 1em;
		} .eab.wiki h5 {
			margin-top: 1.5em;
		} .eab textarea {
			box-shadow: none;
			width: ${blWidth*2 - 4}px;
			font-size: ${font(10)};
		} .eab blockquote, .eab blockquote > p {
			background: ${hsl(1)};
		
		} #eabExternal {
			min-height: 32px;
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
			background-image: url(${logosData});
			background-size: auto 32px;
			filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000) drop-shadow(0 0 2px ${hsl(2)});
			margin-right: 0.5ex;
		} ${logosStyle}
		
		#eabExternalPresets div, .eabSave, .eab.wiki img {
			box-shadow: 0 0 4px ${hsl(3)};
			border: 1px solid ${hsl(4)};
			background: ${hsl(0)};
			font-size: ${font(10)};
		} .eab input, .eab select {
			box-shadow: 0 0 4px ${hsl(4)};
		} .eab input[type="submit"] {
			box-shadow: 0 0 4px ${hsl(3, 100, -1/6)};
			background: ${hsl(1)};
			border: 1px solid ${hsl(4, 100, -1/5)};
			text-shadow: 0 0 3px ${color(2)};
		} .eabSave:not(.inactive):hover, #eabExternalPresets div:hover, .blItem:not(.demo) div:not(.blInput):not(.inactive):hover {
			background: ${hsl(0, 100, -1/10)};
		} .blItem div:not(.blInput).inactive, .eabSave.inactive {
			color: ${color(0, 80)};
			background: ${hsl(1)};
			box-shadow: none;
			
		} #eabBlacklist {
			margin: 2px 0 0 0 !important;
		} .blItem {
			width: ${blWidth}px;
			list-style-type: none;
			margin: 0;
		} .blInput {
			text-shadow: none;
		} .blItem.demo * {
			cursor: default !important;
		} .eabSave, .eab input[type="submit"] {
			cursor: pointer;
			color: ${color(0)};
			text-align: center;
			border-radius: 4px;
			width: ${blWidth - 2}px !important;
			padding: 0.1ex 0 0.2ex;
			margin: 0.5ex 0 !important;
			line-height: 11.5pt;
			font-family: verdana,sans-serif;
			box-sizing: content-box;
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
		} .eabSave.inactive {
			cursor: default;
		} .blItem:first-child div {
			border-top-width: 1px;
		} .blItem:first-child div:last-child { border-top-left-radius: 4px; }
		.blItem:first-child div:first-child { border-top-right-radius: 4px; }
		.blItem:last-child div:last-child { border-bottom-left-radius: 4px; }
		.blItem:last-child div:first-child { border-bottom-right-radius: 4px; }
		
		.eabSave, .blItem div:not(.blInput), #eabExternalPresets div {
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
				n.h2({ text: 'Topics' }),
				n.div({ width: '240px',   desc: n.ul({ class: 'link-page', desc:
					topics.map( topic => n.li({ desc: n.a({ href: `#eab${topic}`, text: `» ${wiki.topics[topic]}` }) }) )
				}) }),
			] }),
			
			n.div({ id: 'wiki-body', desc: [
				n.h1({ text: document.title.split(' - ')[0] }),
				wiki[intro](),
				...topics.map( topic => n.blockquote({ desc: [
					n.h3({ text: wiki.topics[topic], id: `eab${topic}` }),
					...wiki[topic]()
				] }) )
			]}),
			
			n.div({ class: 'Clear' })
		] });
	
	let wiki = {
		topics: { blacklist: 'Blacklist', external: 'External sites', tips: 'Performance', interface: 'Interface', galleries: 'Galleries', restoration: 'Restoring data' },
		help : () => n.p({ style: 'margin-top: 0.5ex', html: `My thread is over <a href="/forum/show/260782">here</a>, I'd love to hear from you. Thoughts, suggestions, any sort of feedback is welcome!` }),
		config : () => n.p(),
		
		blacklist : () => [
			n.p({ text: `Like the site blacklist, this accepts a list of tags separated by spaces. Ratings are toggled on the right. The only permitted modifier is the minus sign to negate a tag. Examples are listed below.` }),
			
			n.h5({ text: 'Configure' }),
			n.div({ id: 'eabBlCont', text: 'Waiting...' }),
			
			n.h5({ text: 'Examples' }),
			n.p({ html: `Blocks explicit and questionable posts tagged "mammal":`, style: 'margin: 0 0 0.25em' }),
			n.div({ desc: blItem('mammal', 'eq', 'demo') }),
			n.p({ html: `Blocks all posts tagged with <b>both</b> "anthro" <b>and</b> "mammal":`, style: 'margin: 0.75em 0 0.25em' }),
			n.div({ desc: blItem('anthro mammal', 'sqe', 'demo') }),
			n.p({ html: `Blocks safe posts tagged with "anthro" but <b>not</b> "mammal":`, style: 'margin: 0.75em 0 0.25em' }),
			n.div({ desc: blItem('anthro -mammal', 's', 'demo') }), n.br(),
		],
		
		external : () => {
			let eabExtPreset = site => n.div({ 'data-site': site, desc: [
					n.a({ class: `eabExt${site}` }),
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
			n.p({ html: `<img src="${GM_getResourceURL('demo')}" />` }),
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
					n.li({ text: `More options to search, like gallery URL.` }),
					n.li({ text: `Searching will find aliases as well. Artists without wikis or with incomplete ones won't be found.` }),
				] }) })
			] }),
			n.p({ text: `Also note that the Wiki search automatically applies wildcards to your search, while you have to add them manually to a Tag search.` })
		],
		
		restoration : () => [
			n.p({ html: `` }),
			n.ol({ desc: [
				n.li({ html: `<a href="${voidUrl}">Create a backup</a> first in case the data you're copying is corrupted somehow.` }),
				n.li({ text: `Open the backup you'd like to restore in a simple text reader program. Your web browser is a reliable option. Copy the contents.` }),
				n.li({ html: `Check this <a href="/set?name=artist_watchlist">set list</a> for a private set created by your account. `, desc: n.ul({ desc:
					n.li({ text: `Very old versions of the tool may have created multiple sets. If you find an extra set that hasn't been updated in a long time, you can safely delete it.` })
				}) }),
				n.li({ text: `Edit the set, and paste the backup into the set description field.` }),
				n.li({ html: `<a href="${voidUrl}">Clear the script's cache.</a>` })
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
			let textarea = n.textarea({ rows: 6, cols: 50, spellcheck: false, onkeyup: () => updateSites().then(refresh) });
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
		if ( blSection !== e.target && !blSection.contains(e.target) ) blSection.style.width = `${blWidth}px`;
		
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
		blSection.style.width = Math.max(width, blWidth) + 'px';
		
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
			storage('eabInvalidateCache', 'true');
			saveCycle('inactive', 'blacklist', blSaveElem, blSave);
		} );
	}
	
	
	//}
	// - - layout/sidebar    //{
	let content = sh.content(), loggedIn = sh.loggedIn();
	let gallery, posts, manageField, backupLink, postList, sidebar, status;
	let voidUrl = 'javascript:void(0);';
	
	let help = {
		span : title => n.span({ class: 'searchhelp', style: 'cursor:help', title, html: '&nbsp; (?)' }),
		a : href => n.a({ class: 'searchhelp', html: '&nbsp; (help)', target: '_blank', href })
	};
	
	log = {
		action : n.div({ text: 'Waiting...' }),
		notice : text => {
			if ( status ) status.insertBefore( n.div({ style: 'margin-bottom: 1em', text: `Notice: ${text}` }), log.action );
		},
		
		set : (line, txt) => {
			if (log[line].textContent === txt) return;
			log[line].textContent = txt;
			if (roles.includes('dev')) console.log(`Log: ${txt}`);
		},   ready : () => {
			log.set('action', 'Ready!');
			log.action.appendChild( n.frag({ desc: [ n.text(' Click '), eabHeart('eabExample', ''), n.text(' anywhere on the site to add an artist. You can search below.') ] }) );
		}
	};
	
	let layout = {
		status : () => status = n.div({ desc: [
			n.h4({ text: titles[ Object.keys(titles).find( page => roles.includes(page) ) ] }),
			log.action
		] }),
		
		// Not here? Try <a>searching the Wiki Gallery</a>, which also scans aliases.
		manage : () => n.div({ desc: [
			n.h5({ text: 'Find an artist' }),
			manageField = n.input({ style: `width:${blWidth - 6}px`, type: 'text', onkeydown: undefined }),
			n.input({ type: 'submit', value: 'Search' })
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
			
			n.div({ desc: [
				n.a({ href: `${window.location.origin}/forum/show/260782`, text: 'Give feedback' }),
				help.span('If you like this script, please leave a comment in my thread! Your feedback is the only way I know if I should maintain and improve the tool.\n\nSuggestions and ideas are very welcome as well.')
			] }),
			
			n.div({ desc: [
				backupLink = n.a({ href: voidUrl, text: 'Create backup', onclick: async () => {
					getPrefs('Retrieving backup...').then( set => {
						saveFile(set.description);
						log.set('action', 'Backup retrieved.');
					} );
				} })
			] }),
			
			n.div({ desc: [
				n.a({ href: voidUrl, text: 'Clear cache', onclick: function() {
					clearStorage();
					storage('eabInvalidateCache', 'true');
					eabRefresh();
				} })
			] })
		] }),
		
		sites : (cond = sites.length) => !cond ? false : n.div({ desc: [
			n.h5({ text: 'Subscriptions' }),
			siteList()
		] })
	};
	
	let siteList = () => n.div({ id: 'eabExternal', desc: sites.map( ex => {
		let {site, mod} = extSiteParse(ex);
		if ( !extSites[site] ) return;
		
		let href = extSites[site].url + (mod || '');
		return n.a({ href, title: extSites[site].name, class: `eabExt${site}` });
	}).filter(defined) });
	
	let eabLayout = () => n.frag({ desc: [
		postList = n.div({ id: 'post-list', class: 'eab', desc: [
			sidebar = n.div({ class: 'sidebar', desc: layout.status() }),
			gallery = n.div({ class: 'content-post' })
		] }), n.div({ class: 'Clear' })
	] });
	
	//}
	
	// - Initialization  - - //{
	let artists = [ ], watch = [ ], layers;
	function init() {
		if ( !prefs ) prefs = JSON.parse(storage('eabPrefs'));
		
		prefs.sites = prefs.sites || [ ];  // backward compatibility: pre-2.0
		
		if ( prefs.time ) {  // alert - does saving config interrupt cache?
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
		/*black = {'adventure_time': 'sqe', 'advertisement': 'sqe', 'alvin_and_the_chipmunks': 'sqe', 'american_dad': 'sqe', 'american_dragon:_jake_long': 'sqe', 'angela-45': 'sqe', 'angry_beavers': 'sqe', 'animal_crossing': 'sqe', 'animal_humanoid': 'sqe', 'animaniacs': 'sqe', 'arthur_(series)': 'sqe', 'barboskiny': 'sqe', 'bat_pony': 'sqe', 'bear_nuts': 'sqe', 'bee_sting': 'sqe', 'bendy_and_the_ink_machine': 'sqe', 'big_anus': 'sqe', 'billmund': 'sqe', 'blowhole': 'sqe', 'brandy_and_mr._whiskers': 'sqe', 'burping': 'sqe', 'chowder_(series)': 'sqe', 'crash_bandicoot_(series)': 'sqe', 'cuphead_(game)': 'sqe', 'dab': 'sqe', 'dangerdoberman': 'sqe', 'diaper': 'sqe', 'disney': 'sqe', 'distracting_watermark': 'sqe', 'dora_the_explorer': 'sqe', 'doug_winger': 'sqe', 'dragon_ball_z': 'sqe', 'dragon_tales': 'sqe', 'dreamworks': 'sqe', 'duck solo': 'sqe', 'elephant': 'sqe', '#password backup for ssh://root@proteles.softhyena.com = yummyyummyyummydaddyscummiesinmytummy69': 'sqe', 'elf': 'sqe', 'faf': 'sqe', 'family_guy': 'sqe', 'fan_character': 'sqe', 'fan_character ~gryphon ~pony': 'sqe', 'fart': 'sqe', 'five_nights_at_freddy\'s': 'sqe', 'foot_fetish': 'sqe', 'foot_focus': 'sqe', 'græyclaw': 'sqe', 'homestuck': 'sqe', 'how_to_train_your_dragon': 'sqe', 'human -anthro': 'sqe', 'human not_furry': 'sqe', 'human solo': 'sqe', 'humanoid': 'sqe', 'hyper': 'sqe', 'infestation': 'sqe', 'inflation': 'sqe', 'invader_zim': 'sqe', 'jasonafex': 'sqe', 'jasonafex type:swf': 'sqe', 'jonny_test': 'sqe', 'kung_fu_panda': 'sqe', 'lilo_and_stitch': 'sqe', 'littlest_pet_shop': 'sqe', 'living_machine': 'sqe', 'madagascar': 'sqe', 'mario_bros': 'sqe', 'mickey': 'sqe', 'minecraft': 'sqe', 'muppets': 'sqe', 'my_life_as_a_teenage_robot': 'sqe', 'my_little_pony': 'sqe', 'my_singing_monsters': 'sqe', 'nedroid': 'sqe', 'nezumi': 'sqe', 'nipple_mouth': 'sqe', 'not_furry': 'sqe', 'old -rating:s': 'sqe', 'overweight': 'sqe', 'photomorph': 'sqe', 'platypus': 'sqe', 'pokémon -arcanine -growlithe -decidueye -rockruff -lycanroc -poochyena -mightyena -furret': 'sqe', 'pony': 'sqe', 'pussy_mouth': 'sqe', 'regular_show': 'sqe', 'rocko\'s_modern_life': 'sqe', 'santa_claus': 'sqe', 'scaredy_squirrel': 'sqe', 'scat': 'sqe', 'scooby-doo_(series)': 'sqe', 'sing_(movie)': 'sqe', 'skeleton -rating:s': 'sqe', 'skunk_fu': 'sqe', 'skunk_spray': 'sqe', 'sonic_(series)': 'sqe', 'sonic_style': 'sqe', 'sonicdash': 'sqe', 'source_filmmaker': 'sqe', 'spanking': 'sqe', 'splatoon': 'sqe', 'spongebob_squarepants': 'sqe', 'spongebob_squarepants_(series)': 'sqe', 'star_fox macro': 'sqe', 'star_fox micro': 'sqe', 'star_wars': 'sqe', 'steven_universe': 'sqe', 'super_planet_dolan': 'sqe', 'switch_dog': 'sqe', 't.u.f.f._puppy': 'sqe', 'the_amazing_world_of_gumball': 'sqe', 'the_buzz_on_maggie': 'sqe', 'the_smurfs': 'sqe', 'them\'s_fightin\'_herds': 'sqe', 'troll': 'sqe', 'turtle': 'sqe', 'undertale rating:e -caprine -canine': 'sqe', 'undertale rating:q -caprine -canine': 'sqe', 'virgin_killer_sweater': 'sqe', 'warner_brothers': 'sqe', 'we_bare_bears': 'sqe', 'xarda': 'sqe', 'yin_yang_yo': 'sqe'};*/
		sites = prefs.sites;
		
		/*for ( let item in black ) {
			let nigga = '';
			if ( Math.random() < 0.5 ) nigga += 's';
			if ( Math.random() < 0.5 ) nigga += 'q';
			if ( Math.random() < 0.5 ) nigga += 'e';
			black[item] = nigga;
		}*/
		
		if ( watch.length >= 400 ) eabCap();
		
		if ( roles.includes('gallery') ) initGallery();
		if ( roles.includes('watchlist') ) initWatchlist();
		if ( roles.includes('artistTags') ) initArtistTags();
		if ( roles.includes('favlist') ) initFavlist();
		if ( roles.includes('config') ) initConfig();
	}
	
	// times that will 
	let timeLayers = [ 'none', 'alias' ];
	function initLayout(parts) {
		sidebar.appendChild( n.frag({ desc: parts.map( part => (typeof layout[part] === 'function') ? layout[part]() : layout[part] ) }) );
		
		layers = [   ...layers,
			{ id: 'alias', desc: `Can't identify artist`, append: help.span(`Possible causes:\n •  this is an alias\n •  name contains illegal characters\n •  tag type isn't "artist" and should be corrected`) },
			{ id: 'none', desc: `No posts found`, append: help.span(`Possible causes:\n •  all posts blacklisted\n •  artist has gone DNP\n •  tag has been replaced with another name, but an alias was not set up\n •  on e926 and no posts exist`) },
			{ id: 'waiting', desc: 'Waiting' }
		];
		
		layers.forEach(layer => {
			gallery.appendChild(n.div({ class: 'eabLayer', id: `eabLayer${layer.id ? layer.id : layers.indexOf(layer)}`, desc:
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
		
		if ( roles.includes('gallery') ) prepGallery();
		if ( paginator ) frag.appendChild(paginator);
		
		prepContent(frag);
	}
	
	if ( roles.includes('help') ) prepContent( wikiTemplate( 'help', ['tips', 'interface', 'galleries', 'restoration'] ) );
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
			{ time: 60*60*24*365*100, desc: 'Older than a year' },
		].filter( layer => layer.id || (layer.time >= lastVisit) );
		
		initLayout( ['manage', 'sites', 'misc'] );
		if (cooldown) ncLog = (storage('eabNcLog')) ? JSON.parse(storage('eabNcLog')) : { };
		
		if ( watch.length === 0 ) log.ready();
		else watch.forEach(artist => {
			if ( prefs.watchlist[artist].i && !storage('eabInvalidateCache') ) {
				let info = { min: prefs.watchlist[artist] };
				
				if ( Array.isArray(info.min.t) ) info.min.t = info.min.t[0];  // backwards compatibility: pre-1.4
				info = { ...info };
				
				if ( cooldown && (!isNew(info.min.t) || ncLog[artist]) ) artists.splice(artists.indexOf(artist), 1);   // don't update
				else info.itemClass = 'eabFade';   // do update
				
				placeItem( info.min.t, artist, info );
				if ( cooldown && isNew(info.min.t) && ncLog[artist] ) ncDisp(artist);
				log.set('action', 'Cached results shown.');
			} else placeholder(artist);
		});
		
		
		if ( roles.includes('dev') ) console.log('Starting watch: ', watch);
		[...artists].reverse().forEach(sanitize);
		if ( artists.length > 0 ) checkChanges().then(getPosts);
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
	
	
	let initCount = [ 0, 0 ], galleryCache = { };
	let initGalleryItem = (artist, info, resolve) => {
		if ( info ) {
			if ( info.swf ) swfRecord[artist] = info.swf;
			galleryCache[artist] = info;
			
			// keep for 4x initial age of the post or 1 day, whichever is larger
			if ( info.min.t < 5 && exp(info.stored, timeout.gallery) ) info.class = 'eabFade';   // do update
			else if ( info.min.t > 5 && exp(info.stored, Math.max(timeout.gallery, (info.stored - info.min.t)*4/60)) ) info.class = 'eabFade';
			else artists.splice(artists.indexOf(artist), 1);   // don't update   // alert - implement per-item cache expiry for gallery
			
			placeItem( info.min.t, artist, info );
			log.set('action', 'Cached results shown.');
			
		} else placeholder(artist);
		
		initCount[1]++;
		if (initCount[0] === initCount[1]) resolve();
	};
	
	let handleStore = () => new Promise( resolve => {
			initCount[0] = artists.length;
			artists.forEach(artist => {
				idbGet(artist).then(info => initGalleryItem(artist, info, resolve));
			});
		});
	
	async function initGallery() {
		artists = [...lineArtists];
		layers = [ { time: 0, desc: 'List' } ];
		
		modPaginator('basis=true');
		initLayout( ['search', 'misc'] );
		
		[...artists].reverse().forEach(sanitize);
		if (artists.length === 0) log.set('action', 'No results.');
		
		if ( !idb ) await idbPrep();
		handleStore().then(getPosts);
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
	
	// - Formation - - - - - //
	// - - data search       //{
	let permit = { }, find;
	let postTime = (artist) => {
		if ( roles.includes('watchlist') && prefs.watchlist[artist] ) return prefs.watchlist[artist].t;
		else if ( roles.includes('gallery') && galleryCache[artist] ) return galleryCache[artist].min.t;
	};
	
	let sanitize = artist => {
		if ( forbidden.start.includes(artist.charAt(0)) || forbidden.any.some(ch => artist.includes(ch)) ) missingItem('alias', artist);
	};
	
	function getPosts(lim = tagLim[host]) {
		if ( artists.length === 0 ) return;
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
		console.log('Searching: ', find);
		request('GET', '/post/index.json', [`tags=${tags}`]).then(createGallery);
		log.set('action', 'Requesting posts...');
	}
	
	
	//}
	// - - data handling     //{
	let retryCounter = 0, blRecord = [ ], swfRecord = { }, pLim, s, ncList, p, d;
	async function galleryItem(item, last) {
		let artist, f = find.findIndex(name => item.artist.includes(name));
		if ( f > -1 ) artist = find[f];
		let info = distillItem(item, artist);
		
		// if another artist matches this post, run it again
		if ( find.some( name => (name !== artist) && item.artist.includes(name) ) ) d--;  // alert - is this working?
		// stop if artists processed === artists searched
		if ( p >= s && (!isNew(info.min.t) || roles.includes('gallery')) ) return d = 500;
		
		let itemTags = info.tags.split(' ');
		let blacklisted = Object.keys(prefs.blacklist).some(blTags => {
			if ( !prefs.blacklist[blTags].includes(info.rating) ) return false;
			else return blTags.split(' ').every(tag => {
				if ( tag.charAt(0) === '-' ) return ( !itemTags.includes(tag.substr(1)) );
				else return ( itemTags.includes(tag) );
			});
		});
		
		if ( blacklisted ) return blRecord.push(info.min.i[2]);
		if ( artist ) {
			if ( roles.includes('gallery') && info.min.flash ) return swfRecord[artist] = swfRecord[artist] || info;
			
			p++;
			find.splice(f, 1);
			
			
			/*removeItem(artist);
			placeItem(info.min.t, artist, info);
			
			if ( roles.includes('watchlist') ) prefs.watchlist[artist] = info.min
			else if ( roles.includes('gallery') ) idbPut({ ...info, swf: swfRecord[artist] });*/
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
		
		if (data.length === 0) {   // nothing found
			missingItem('none', find[0]);
			
		} else if (p === 0) {   // something found, but nothing processed - either blacklisted or an alias
			if ( s > 1 ) retryCounter = pLim;   // try again, 1 at a time, for all parts of input
			else if ( roles.includes('gallery') && swfRecord[find[0]] ) presentItem(swfRecord[find[0]], find[0]);
			else missingItem('alias', find[0]);   // alert - but what if it's blacklisted? will be miscategorized
		}
		
		if ( retryCounter > 0 && artists.length > 0 ) getPosts(1);
		else if ( artists.length > 0 ) getPosts();
		else {
			if ( !roles.includes('watchlist') ) return log.set('action', 'Done!');
			
			if ( ncLog ) storage('eabNcLog', ncLog);
			if ( !cooldown ) prefs.time = [ now(), prefs.time[0] ];
			
			saveChanges();
		}
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
	
	
	let newItemLinks = (artist, width, href, heart) => 
		n.span({ class: 'post-score', ...width && { style: `width: ${width}` }, desc: [
			heart,  n.a({ class: 'eabWiki', href: `/artist/show?name=${artist}`, text: '?' }),
			n.a({ href, desc: [ n.span({ text: artist.replace(/_/g, ' '), title: artist }) ] })
		] });
	
	
	let months = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
	let imHost = `${window.location.protocol}//static1.${window.location.host}/`;
	function newItem(artist, info) {
		let imSrc, md5 = info.min.i[2] || false;
		
		if (!md5) imSrc = '';
		else if (md5.length === 32) {
			if (blRecord.includes(md5)) imSrc = '/images/blacklisted-preview.png';
			else if (info.min.flash) imSrc = 'images/download-preview.png';
			else imSrc = `data/preview/${md5.substring(0,2)}/${md5.substring(2,4)}/${md5}.jpg`;
		
		// backward compatibility: pre-1.4
		} else if (md5.includes('download-preview.png')) {
			imSrc = 'images/download-preview.png';
			md5 = false;
		} else if (md5.includes('/')) {
			imSrc = `data/preview/${md5}`;
			md5 = md5.split('/').pop().replace('.jpg', '');
		}
		
		let href = `/post?tags=${artist}`;
		if ( roles.includes('gallery') ) href += ` order:favcount`;
		
		let alt = '';
		if (info.tags) alt = `${info.tags} \n\nArtist tags: ${info.artistTags.join(', ')} \nRating: ${{'s':'Safe','q':'Questionable','e':'Explicit'}[info.rating]} \nScore: ${info.score} \nFaves: ${info.fav_count}`;
		
		let dText = false;
		if ( info.min.t > 5 && roles.includes('watchlist') ) {
			let date = new Date(info.min.t*1000);
			dText = [ n.text(`${('0' + date.getDate()).slice(-2)} ${months[date.getMonth()]} `), n.span({ class: 'eabFade', text: date.getFullYear() }) ];
		}
		
		let dims = (blRecord.includes(md5)) ? dInfo.min.i : info.min.i;
		let heart = ( info.min.t < 5 && !watch.includes(artist) ) ? false : eabHeart(artist, 'heart');
		
		return n.span({ id: info.itemId || `ab-${artist}`, class: `thumb ${info.itemClass || ''}`, 'data-time': info.min.t, desc:
			n.span({ style: `width: ${pWidth(dims[0])}`, desc: [
				swfRecord[artist] && !info.min.flash && n.a({ href: `/post/show?md5=${swfRecord[artist].min.i[2]}`, class: 'eabSwfNotice', text: 'swf' }),
				n.a({ ...md5 && { href: `/post/show?md5=${md5}` }, desc: [
					n.img({ class: 'preview', alt, title: alt, width: `${dims[0]}px`, height: `${dims[1]}px`,
					... !roles.includes('noImage') && { src: imHost + imSrc } })
				] }),
				!( info.itemClass && info.itemClass === 'slave' ) && newItemLinks( artist, '', href, heart ),
				dText && n.a({ href, class: 'post-score post-date', desc: dText })
			] })
		});
	}
	
	function placeholder(artist) {
		getId(`eabLayerwaiting`).style.display = 'block';
		gallery.insertBefore( newItem(artist, dInfo), gallery.lastElementChild );
	}
	
	
	//}
	// - - placement         //{
	let times = [ ], ncOffset = { }, order = [ ];
	function placeItem(time, artist, info) {
		let place, offset = 0;
		times.push(time);
		times.sort().reverse();
		place = times.indexOf(time);
		
		if ( roles.includes('watchlist') ) {
			sorted.splice(place, 0, artist);
			for (let i = 0; i < place; i++) offset += ncOffset[sorted[i]] || 0;
			
		} else if ( roles.includes('gallery') && time > 5 ) {
			order.push(lineArtists.indexOf(artist));
			order.sort( (a, b) => a - b );
			
			place = order.indexOf(lineArtists.indexOf(artist));
		}
		
		let layer = timeLayers[time] || 0;
		if ( !layer ) layers.forEach(a => { if (a.time && (now() - time) > a.time) layer++; });
		
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
		
		if ( roles.includes('gallery') ) idbPut({ min, artist });
		if ( roles.includes('watchlist') ) prefs.watchlist[artist] = min;
	}
	
	function presentItem(info, artist) {
		removeItem(artist);
		placeItem(info.min.t, artist, info);
		
		if ( roles.includes('gallery') ) idbPut({ ...info, swf: swfRecord[artist] });
		if ( roles.includes('watchlist') ) prefs.watchlist[artist] = info.min;
	}
	
	function removeItem(artist) {  // check not involved with gallery
		if ( artists.includes(artist) ) artists.splice(artists.indexOf(artist), 1);
		let prior = sorted.indexOf(artist);
		if ( prior > -1 ) {
			sorted.splice(prior, 1);
			times.splice(prior, 1);
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
		let data = await request('GET', '/post/index.json', [`tags=${artist}`, `page=${page}`]);
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
			
			request('GET', '/post/index.json', [`tags=${searchTags}`, `page=${page}`]).then(favlist);
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

			item.artist.forEach(artist => {
				if ( !notArtists.includes(artist) ) postCont.appendChild( newItemLinks(artist, pWidth(item.preview_width), `/post?tags=${artist}`, eabHeart(artist, item.id)) );
			});

			if (postCont.childElementCount === 2) postCont.appendChild(n.span({ style: `width: ${pWidth(item.preview_width)}`, class: 'post-score eabGray', text: 'unknown' }));
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
		log.notice('Watchlist cap of 400 reached.');
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
		else if ( sorted.includes(artist) ) purge.splice(0, 0, artist);
		
		directory[artist].forEach(id => { getId(id).className = heartClass(artist) + ' eabFade'; });
		
		saveChanges().then( () => {
			directory[artist].forEach(id => {
				getId(id).className = heartClass(artist);
			} );
		});
	}
	
	//}
	// - - comms             //{
	let setDesc = () => 'This private set contains your configuration of the \nArtist Watchlist script. It is used so your list can be\npermanently stored between sessions. If this set\nis tampered with, the script may malfunction.\n\n' + LZString.compressToUTF16(JSON.stringify(prefs));
	
	let reqLog = { }, lastReq = 0;
	async function request(method, url, data = []) {
		// rate limiting
		let wait = 500 - (Date.now() - lastReq);
		if ( wait > 0 ) await timer(wait);
		lastReq = Date.now();
		
		let form, agent = `Artist_Basis/${GM_info.script.version} (by index on e621)`;
		if ( Array.isArray(data) ) {
			form = null;
			data.push(`_client=${agent}`);
			url += '?' + data.join('&');
		} else {
			form = new FormData();
			data['_client'] = agent;
			for (let part in data) form.append(part, data[part]);
		}
		
		if ( url.includes('/post/index.json') ) {   // alert - extend this
			if ( reqLog[url] ) quit(`Error: loop detected on query '${url}'`);
			reqLog[url] = true;
		}
		
		return new Promise( function(resolve, reject) {
			let page = new XMLHttpRequest();
			xhr.push(page);
			page.onreadystatechange = function() {
				if ( page.readyState !== 4 ||  page.status === 0) return;
				if ( page.status >= 200 && page.status < 300 ) resolve(page.response);
				else quit(`Server error: ${page.status} on ${page.responseURL}`);
			};
			
			page.open(method, encodeURI(window.location.origin + url), true);
			page.responseType = 'json';
			
			page.send(form);
		});
	}
	
	function eabRefresh() {
		if (roles.includes('artistTags')) {
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
	
	// check for more recent changes if preferences were recorded for this session more than x min ago
	async function checkChanges() {
		if ( exp(storage('eabTime'), timeout.storage) ) {   // ALERT
			let eabPrefs = await getPrefs('Checking for changes...').then(handlePrefs);
			let diff = assembleWatch(eabPrefs.watchlist).filter( name => watch.indexOf(name) < 0 );
			
			if ( diff.length > 0 /*|| eabPrefs.sites !== sites || eabPrefs.blacklist !== black */) return eabRefresh();
		}
		
		return Promise.resolve();
	}

	async function saveChanges() {
		log.set('action', 'Saving watchlist...');
		
		let set = watch;
		if ( roles.includes('watchlist') ) set =[ ...new Set([...sorted, ...watch]) ];
		
		// combine sorted and artists, remove duplicates and unfavorited
		let list = set.filter( artist => !purge.includes(artist) );
		prefs.watchlist = assembleCache(list, prefs.watchlist);
		
		await checkChanges();
		let compressed = setDesc();
		
		console.log(compressed);
		console.log(prefs);
		console.log('Ending watch: ', list);
		
		await request('POST', '/set/update.json', { 'set[description]': compressed, 'set[id]': storage('eabSetId') });
		
		storage('eabPrefs', prefs);
		storage('eabTime', now());

		if ( storage('eabInvalidateCache') ) localStorage.removeItem('eabInvalidateCache');
		log.set('action', 'Done!');
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
	}
	
	let trans, store;
	let idbGet = get => new Promise( function(resolve, reject) {
		if ( !idb ) return resolve();
		
		if ( !store ) {
			trans = idb.transaction('items', 'readonly');
			store = trans.objectStore('items');
		}
	
		let req = store.get(get);
		
		req.onsuccess = function(event) {
			resolve(req.result);
		};
	});
	
	let idbPut = put => new Promise( function(resolve, reject) {
		if ( !idb ) resolve();
		else resolve( idb.transaction('items', 'readwrite').objectStore('items').put(put) );
	});
	
	let idb = false, idbReq, idbPromise = false;
	function idbPrep() {
		//indexedDB.deleteDatabase('eabGallery');
		if ( !idbPromise ) idbPromise = new Promise( function(resolve, reject) {
			idbReq = indexedDB.open('eabGallery', 1);
			console.log(idbReq);
			
			idbReq.onupgradeneeded = event => {
				let store = idbReq.result.createObjectStore('items', { keyPath: 'artist' });
			//	store.createIndex('by_artist', 'artist', { unique: true });
			};
			
			idbReq.onerror = event => {
				log.notice('Cache failed, likely a Firefox private browsing bug.');
				resolve();
			};
			
			idbReq.onsuccess = event => {
				idb = idbReq.result;
				idb.onerror = event => quit(`indexedDB error: ${event.target.error}`);
			//	idbTrans = idb.transaction('items', 'readwrite');
				resolve();
			};
		});
		
		return idbPromise;
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
	if ( storage('eabUserName') !== cookie.login || storage('eabVersion') !== GM_info.script.version ) clearStorage();
	storage('eabUserName', cookie.login);
	storage('eabVersion', GM_info.script.version);
	
	async function getPrefs(action) {
		log.set('action', action);
		let sets;
		
		// if we have the set id, get it directly
		if (storage('eabSetId')) sets = await request('GET', '/set/show.json', [`id=${storage('eabSetId')}`]);
		// else use post ID and refine with user ID
		else {
			if (!storage('eabUserId')) await request('GET', '/user/show.json').then( user => storage('eabUserId', user.id) );
			sets = await request('GET', '/set/index.json', [`user_id=${storage('eabUserId')}`, 'post_id=65067']);
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
		let create = await request('POST', '/set/create.json', { 'set[name]': name, 'set[shortname]': name, 'set[public]': 'false', 'set[description]': setDesc() });
		
		storage('eabSetId', create.set_id);
		await request('POST', '/set/add_post.json', [`set_id=${storage('eabSetId')}`, 'post_id=65067']);
		return Promise.resolve(eabPrefs);
	} 
	
	if ( storage('eabTime') && storage('eabSetId') && storage('eabPrefs') ) init();
	else getPrefs('Requesting user data...').then(handlePrefs, firstTime).then(readyPrefs).then(init);
	//}
	
})();