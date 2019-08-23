// ==UserScript==
// @name         Artist Watchlist
// @description  Follow posts from your favorite artists!
// @namespace    https://e621.net/artist/watchlist
// @version      1.4.0
// @author       index
// @license      GPL-3.0-or-later
// @match        *://*.e621.net/*
// @match        *://*.e926.net/*
// @run-at       document-start
// @grant        GM_addStyle
// @updateURL    https://openuserjs.org/meta/index-eaw/Artist_Watchlist.meta.js
// @downloadURL  https://openuserjs.org/install/index-eaw/Artist_Watchlist.user.js
// @require      https://raw.githubusercontent.com/pieroxy/lz-string/master/libs/lz-string.min.js
// ==/UserScript==

let style;
if (window.location.pathname.split('/').filter(part => part)[0] === 'artist') style = '#navbar li:nth-child(7) a::before { padding-right: 20px; content: "Basis ";';
else style = '#navbar li:nth-child(6) a::after { padding-left: 20px; content: " Basis";';

GM_addStyle(style + `

    color: #b4c7d9;
}`);

// 20px

// GreaseMonkey fix - globalize access to the native e621 mode menu
try {
	if (PostModeMenu) window.PostModeMenu = PostModeMenu;
} catch (error) {
	if (!window.PostModeMenu) window.PostModeMenu = window.wrappedJSObject['PostModeMenu'];
}

throw new Error('');

window.addEventListener('DOMContentLoaded', async function() {
	"use strict";
	let notArtists = [ 'unknown_artist', 'unknown_artist_signature', 'unknown_colorist', 'anonymous_artist', 'avoid_posting', 'conditional_dnp', 'sound_warning', 'epilepsy_warning' ];
	let tagLim = { 'e621.net': 6, 'e926.net': 5 };   // higher-tier accounts can increase these
	let timeout = { 'cache': 60, 'storage': 5, 'gallery': 12*60 };   // in minutes
	let ppa = 8;   // posts per artist - increasing results in larger but fewer server requests, can be tweaked for performance
	let blackhole = false;
	let priority = 'favcount';
	
	
	//--------------------//
	//-- General --------//{
	//--------------------//
	let log, xhr = (page) => {
		if (!xhr[page]) xhr[page] = new XMLHttpRequest();
		return xhr[page];
	};
	
	function quit(msg) {
		if (log) log.set('action', msg);
		for (let page in xhr) if (xhr[page] instanceof XMLHttpRequest) xhr[page].abort();
		throw new Error(msg);
	}
	
	document.addEventListener('keydown', (e) => { if (e.keyCode === 27) quit('Halted with Esc key.'); });
	if (Array.prototype.toJSON) delete Array.prototype.toJSON;
	
	let now = () => Date.now()/1000;
	let lastVisit = now(), lastSaved = now(), cooldown;
	let isNew = (t) => (t > now() - lastVisit);
	
	let getId = (select) => document.getElementById(select);
	let getClass = (select) => document.getElementsByClassName(select);
	let getCss = (select) => document.querySelectorAll(select);
	
	// node creator
	let n = {
		elem: (node, props) => {
			if (props) for (let [prop, val] of Object.entries(props)) {
				if ( Array.isArray(val) ) val.forEach( sub => n.assign(node, prop, sub) );
				else n.assign(node, prop, val);
			}
			return node;
		},
		assign: (node, prop, val) => {
			if (prop === 'desc') node.appendChild(val);
			else if (prop === 'text') node.appendChild(n.text(val));
			else if (prop === 'html') node.innerHTML = val;
			else if (prop.substring(0,2) === 'on') node.addEventListener(prop.substr(2), val);
			else node.setAttribute(prop, val);
		},
		text: cont => document.createTextNode(cont),
		frag: props => n.elem(document.createDocumentFragment(), props)
	};
	
	['div', 'span', 'a', 'img', 'li', 'h5', 'style', 'input', 'ul', 'option', 'br', 'label'].forEach(tag => {
		n[tag] = props => n.elem(document.createElement(tag), props);
	});
	
	let nav = getId('navbar');
	n.subnav = (page, text) => n.li({ desc: n.a({ href: sh.wlFormat(page), text }) });
	if (nav) nav.insertBefore( n.li({ desc: n.a({ href: '/artist/watchlist', text: 'Basis' }) }), nav.children[6] );
	GM_addStyle(`
	#navbar li:nth-child(6) a::after {
		content: "";
	} #navbar li:nth-child(6)  {
		margin-right: 0;
	}`);

	
	// toggle class and return true if toggled on
	function toggle(elem, selector1, selector2 = '') {
		let current = elem.className.split(' '), index;
		
		[selector2, selector1].forEach(selector => {
			index = current.indexOf(selector);
			if (index > -1) current.splice(index, 1);
			else current.push(selector);
		});
		
		elem.className = current.join(' ');
		return (index === -1);
	}
	
	
	//}-------------------//
	//-- Site handling --//{
	//--------------------//
	let sh, host = window.location.host.split('.').slice(-2).join('.');
	let e621 = ['e621.net', 'e926.net'].includes(host);
	let dan = (host === 'donmai.us');
	
	let cookie = { };
	document.cookie.split('; ').forEach(crumb => { cookie[crumb.split('=')[0]] = crumb.split('=')[1]; });
	console.log('cookie', cookie);
	
	if (e621) sh = {
		scheme   : () => getId('user_css').value,
		wlFormat : (page) => `/artist/${page}`,
		content  : () => getId('content'),
		loggedIn : () => ('login' in cookie),
		subnav   : () => getId('subnav').firstElementChild,
	};
	
	if (dan) sh = {
		scheme   : () => 'danbooru',
		wlFormat : (page) => `/artists?page=${page}`,
		content  : () => getId('page'),
		loggedIn : () => true, // doesn't matter
		subnav   : () => getId('nav').children[1],
	};
	
	// flags
	let sidebars = getClass('sidebar');
	let searchTags, roles = [];
	
	if (window.location.search === '?dev') roles.push('dev');
	if (getId('searchform') && window.location.pathname.includes('/artist')) roles.push('gallery');
	
	if (window.location.href.split(host)[1] === sh.wlFormat('watchlist')) roles.push('watchlist');
	if (sidebars.length > 0) roles.push('artistTags');
	if (getId('tags')) {
		roles.push('favlist');
		searchTags = decodeURIComponent(window.location.href.split('/').pop().split('=').pop());
		if (!isNaN(searchTags) || searchTags === 'index') searchTags = '';
	}
	
	
	//}-------------------//
	//-- Style ----------//{
	//--------------------//
	let styleElem, style, scheme = sh.scheme(), dColors = {
		dark:   { val: [ 33, 30, 25, 15 ], text: [ 'FFF', 'BBB', '000' ] },  // ordered from most contrast -> least
		light:  { val: [ 33, 30, 25, 15 ], text: [ '000', 'BBB', 'FFF' ] },
	}, colors = {
		'danbooru':                   { temp: 'hsla(  0,   0%, &V%, &O%)', ...dColors.dark },
		'hexagon':                    { temp: 'hsla(217,  53%, &V%, &O%)', ...dColors.dark },
		'hexagon,skin-hexagon-clean': { temp: 'hsla(217,  53%, &V%, &O%)', ...dColors.dark },
		'hexagon,skin-pony':          { temp: 'hsla(268,  53%, &V%, &O%)', ...dColors.dark },
		'hexagon,skin-bloodlust':     { temp: 'hsla(  0,   0%, &V%, &O%)', ...dColors.dark, val: [ 25, 22, 17, 7 ], tSizeAdjust: 1 },
		'hexagon,skin-serpent':       { temp: 'hsla(130,  80%, &V%, &O%)', val: [ 58, 54, 49, 43 ], text: [ '000', '0e8121', 'FFF' ] },
		'hexagon,skin-hotdog':        { temp: 'hsla(360, 100%, &V%, &O%)', val: [ 46, 44, 42, 40 ], text: [ '000', '600', 'ff5757' ] }
	};
	
	let hsl = (variant, opacity = 100) => colors[scheme].temp.replace('&V', colors[scheme].val[variant]).replace('&O', opacity);
	let color = (variant) => '#' + colors[scheme].text[variant];
	let font = (def) => def + ( colors[scheme].tSizeAdjust || 0 ) + 'pt';
	
	let blWidth = 189, pWidthMin = 80, pPadding = '0.6ex';
	let pWidth = (x) => `calc(${Math.max(x, pWidthMin)}px + ${pPadding} + ${pPadding})`;
	
	style = () => `
		.eab input:disabled { background: #555 }
		.eab:not(.favlist) { display: initial }
		.eab:not(.favlist) .sidebar {
			position: sticky;
			top: 0;
			padding-top: 1ex;
			z-index: 100;
		} .eab .sidebar::-webkit-scrollbar { 
			display: none;
		} .eab .sidebar > div {
			margin: 0 0 1.5em
		} .eabFade {
			opacity: 0.5;
		} .eab input {
			border: 1px solid ${hsl(3)};
			border-radius: 4px;
			box-shadow: none;
		} .eab input[type="checkbox"] {
			margin: 0.4ex 0.7ex;
			padding: 0;
			top: 1px;
		} .eab label {
			font-weight: inherit;
			
		} .eab td {
			padding: 1px 8px 1px 0
		} #eabSearch input {
			width: 133px !important;
		} #eabSearch select {
			width: 138px !important;
		
		} .eab span.thumb {
			height: inherit;
			margin: 1em 0;
			/*height: calc(150px + 1rem + 10pt + 4px);*/
		} .eab span.thumb a {
			box-shadow: none;
		} span.thumb a:first-child {
			display: initial;
		} .eab span.thumb a[href] {
			cursor: pointer;
		} .eab span.thumb > span {
			position: relative;
			display: block;
			margin: auto;
		} .eab img.preview {
			border: 1px solid ${hsl(3)};
			border-radius: 4px 4px 0 0;
			background: ${hsl(1)};
		} #content #tag-sidebar .eabHeart {
			position: absolute;
			left: -1em;
			font-weight: normal !important;
		} #content .eabHeart {
			cursor: pointer;
			color: #888;
			text-shadow: -1px 0 #000, 0 1px #000, 1px 0 #000, 0 -1px #000;
		} #content .eabFav {
			color: #ff66a3;
		} .eab.highlight span.thumb {
			opacity: 0.25;
		} .eab span.thumb.slave {
			/*background: rgba(0, 0, 0, 0.3);
			padding: 1ex 0;*/
			opacity: 1;
		
		} .eab .post-score {
			background-color: ${hsl(0)};
			color: ${color(0)};
			border-radius: 0;
			display: block;
			width: inherit;
			border: 1px solid ${hsl(3)};
			border-width: 0 1px 1px;
			box-sizing: border-box;
			font-size: ${font(10)};
		} .eab .post-score:not(.post-date) span:last-child {
			padding: 0 5px;
		
		} .eab .post-score .eabHeart, .eab .post-score .eabWiki, .eab .newCounter::before {
			float: left;
			width: 0;
			transition: all 0.15s linear;
			opacity: 0;
		} .eab .newCounter::before {
			overflow: hidden;
			text-align: left;
		} .eab .expand::before { content: 'expand ';
		} .eab .collapse::before { content: 'collapse ';
		} .eab .post-score .eabHeart, .eab .post-score .eabWiki {
			padding: 0;
			border: none;
			font-size: 10pt;
		} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki, .eab .thumb:hover .newCounter::before {
			opacity: 1;
		} .eab .thumb:hover .expand::before { width: 7ch;
		} .eab .thumb:hover .collapse::before { width: 9ch;
		} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki {
			width: initial;
			border-right: inherit;
			padding: 0 5px;
		
		} .favlist .post-score:last-of-type, .eab a.post-score:last-of-type {
			border-radius: 0 0 4px 4px;
		} .eab .post-date {
			background: ${hsl(1)};
			font-size: ${font(7)};
			line-height: 10pt;
		} .post-date .eabFade {
			padding-left: 0.5ex;
		} .eab .post-score:not(.post-date) {
			line-height: 1rem;
		} .eab .newCounter {
			position: absolute;
			top: -${pPadding};
			right: 0;
			z-index: 10;
			border-radius: 0 4px;
			font-family: courier;
			font-size: 8pt;
			line-height: 1.00;
			padding: 0.6ex;
			border: 1px solid ${hsl(3)};
			background: ${hsl(0)};
			cursor: pointer;
		
		} .favlist .eabGray {
			color: ${color(1)};
			cursor: default;
			font-style: italic;
		} .eab .post-score a:hover {
			/*opacity: 0.8;*/
		} .eab .post-score a, .eab .post-score a:hover {
			padding: 0 5px;
			color: ${color(0)};
			display: block;
		
		} .eabLayer, .eabLayer div {
			border-radius: 3px;
			color: ${color(0)};
			text-shadow: 0 0 3px ${color(2)};
			font-size: ${font(10.5)};
			border: 1px solid;
			border-width: 1px 0 1px 1px;
		} .eabLayer {
			margin-top: 1.5em;
			display: none;
			border-image: linear-gradient(to right, rgba(0,0,0,0.5), rgba(0,0,0,0.3) 40%, rgba(0,0,0,0) 90%, rgba(0,0,0,0)) 1;
		} .eabLayer > div {
			padding: 0.2em 0.8em 0.3em;
			background: linear-gradient(to right, ${hsl(2)}, ${hsl(2,80)} 40%, ${hsl(2,0)} 90%);
			border-image: linear-gradient(to right, ${hsl(0)}, ${hsl(0,80)} 40%, ${hsl(0,0)} 90%) 1;
		} .eab .content-post {
			margin-top: -1.5em;
		
		} #eabBlacklist {
			width: ${blWidth}px;
			margin: 2px 0 0 0;
		} #eabSave {
			cursor: pointer;
			color: ${color(0)};
			text-shadow: 0 0 3px ${color(2)};
			text-align: center;
			background: ${hsl(0)};
			border-radius: 4px;
			border: 1px solid ${hsl(3)};
			width: ${blWidth - 2}px;
			padding: 0.1ex 0 0.2ex;
			margin: 2px 0 1ex;
			line-height: 11.5pt;
		} #eabSave, #eabBlacklist div:not(:last-child) {
			-moz-user-select: none;
			-webkit-user-select: none;
		} #eabSave:active {
			background: ${hsl(1)};
		} #eabSave.inactive {
			cursor: default;
		} #eabBlacklist li:first-child div {
			border-top-width: 1px;
		} #eabBlacklist div:last-child {
			width: auto;
			border-left-width: 1px;
			background: #FFF;
			overflow: hidden;
			color: #000;
			padding-left: 2px;
			white-space: nowrap;
		} #eabBlacklist div:last-child:focus {
			background: #FFC;
		} #eabBlacklist div:not(:last-child) {
			cursor: pointer;
			float: right;
			color: ${color(0)};
			text-shadow: 0 0 3px ${color(2)};
			width: 3ex;
			text-align: center;
		} #eabBlacklist div {
			background: ${hsl(0)};
			border: 1px solid ${hsl(3)};
			border-width: 0 1px 1px 0;
			vertical-align: bottom;
			text-overflow: ellipsis;
			position: relative;
			z-index: 1000;
			font-size: ${font(9)};
			padding: 0.1ex 0 0.2ex;
		} #eabBlacklist div:not(:last-child).inactive, #eabSave.inactive {
			color: ${color(1)};
			background: ${hsl(2)};
		} #eabBlacklist li:first-child div:last-child { border-top-left-radius: 4px; }
		#eabBlacklist li:first-child div:first-child { border-top-right-radius: 4px; }
		#eabBlacklist li:last-child div:last-child { border-bottom-left-radius: 4px; }
		#eabBlacklist li:last-child div:first-child { border-bottom-right-radius: 4px; }
	`;
	
	document.head.appendChild(styleElem = n.style({ text: style() }));
	if (e621) getId('user_css').addEventListener('change', () => {
		scheme = event.target.value;
		styleElem.innerHTML = style();
	});
	
	
	//}-------------------//
	//-- Blacklist ------//{
	//--------------------//
	let bl, blInputList, blSection, blSaveElem, blReady = true;
	if (roles.includes('watchlist')) {
	}
	
	function blItem(tag, ratings) {
		let li = n.li();
		
		['s','q','e'].forEach(c => {
			li.appendChild( n.div({ 'text': c, 'class': (ratings.includes(c)) ? 'active' : 'inactive', 'onclick': blRatingCycle }) );
		});
		
		li.appendChild( n.div({ 'data-ratings': ratings, 'class': 'blInput', 'text': tag, 'contenteditable': 'true', 'desc': n.br(), 'onfocus': blAdjust, 'oninput': [ blAdjust, blSaveCycle ], 'onkeypress': blEnter }) );
		
		blSection.appendChild(li);
		if (sidebar && sidebar.offsetHeight > window.innerHeight) sidebar.style.position = 'initial';
	}
	
	function blUnfocus(e) {
		if (blSection !== e.target && !blSection.contains(e.target)) blSection.style.width = blWidth + 'px';
		
		for (let i = 0; i < blInputList.length - 1;) {
			if (e.target === blInputList[i] || e.target.parentNode === blInputList[i].parentNode) i++;
			else if (blInputList[i].textContent.length === 0) blInputList[i].parentNode.remove();
			else i++;
		}
		if (blInputList[blInputList.length-1].textContent.length !== 0) blItem('', 'sqe');
	}
	
	function blAdjust(e) {
		if (!blReady) return e.target.blur();
		
		if (!blAdjust.context) {
			let canvas = document.createElement('canvas');
			blAdjust.context = canvas.getContext('2d');
			blAdjust.context.font = '9pt verdana';
		}
		
		let width = blAdjust.context.measureText(this.textContent + 'mxxxxxxxxx').width; // em + 9ex
		blSection.style.width = (width > blWidth) ? width + 'px' : blWidth + 'px';
		
		if (blInputList[blInputList.length-1].textContent.length !== 0) blItem('', 'sqe');
	}
	
	function blEnter(e) {
		if (e.keyCode !== 13) return;
		blInputList[blInputList.length - 1].focus();
		e.preventDefault();
	}
	
	function blRatingCycle() {
		if (!blReady) return;
		let c = this.innerHTML, input = this.parentNode.lastElementChild, ratings = input.dataset.ratings;
		
		this.className = ratings.includes(c) ? 'inactive' : 'active';
		ratings = ratings.includes(c) ? ratings.replace(c, '') : ratings + c;
		
		input.dataset.ratings = ratings;
		blSaveCycle();
	}
	
	function blSaveCycle(on = true) {
		blSaveElem.innerHTML = on ? 'Save' : 'Saving...';
		blSaveElem.className = on ? '' : 'inactive';
		blSaveElem.onclick = on ? blSave : undefined;
	}
	
	function blSave() {
		blReady = false;
		blSaveCycle(false);
		
		bl = {};
		Array.from(blInputList).forEach(elem => {
			if (elem.textContent === '') return;
			bl[elem.textContent] = elem.dataset.ratings;
		});
		
		prefs.blacklist = bl;
		saveChanges(function () {
			clearStorage();
			storage('eabInvalidateCache', 'true');
			eabRefresh();
		});
	}
	
	
	//}-------------------//
	//-- Layout ---------//{
	//--------------------// 
	let content = sh.content(), loggedIn = sh.loggedIn();
	let gallery, posts, manageField, backupLink, subnav, postList, sidebar;
	
	if (window.location.pathname.substr(0,7) === '/artist') {
		subnav = sh.subnav();
		subnav.appendChild(n.subnav('watchlist', 'Watchlist'));
	}
	
	log = {
		reset: () => { for (let line in log) if (line !== 'det') log[line].innerHTML = ''; },
		set: (line, txt) => { if (log[line]) log[line].innerHTML = txt; },
		hide:     (line) => { if (log[line]) log[line].style.display = 'none'; },
		unhide:   (line) => { if (log[line]) log[line].style.display = ''; }
	};
	
	let helpSpan = (title) => n.span({ class: 'searchhelp', style: 'cursor:help', title, html: '&nbsp; (?)' });
	let layout = {
		status : () => n.div({ desc: [
			n.h5({ text: 'Status' }),
			log.notice = n.div({ text: '' }),
			n.div({ desc: [
				log.det = n.a({ style: 'display: none', href: 'javascript:void(0);', text: 'Click to confirm: ' }),
				log.resolution = n.span({ text: '' })
			] }),
			log.action = n.div({ text: 'Requesting user data...' })
		] }),
		
		manage: () => n.div({ desc: [
			n.h5({ text: 'Add/remove artist' }),
			manageField = n.input({ style: `width:${blWidth - 6}px`, type: 'text' })
		] }),
		
		blacklist: () => {
			blInputList = getClass('blInput');
			blSection = n.ul({ id: 'eabBlacklist' });
			
			document.addEventListener('click', blUnfocus);
			blItem('', 'sqe');
			
			return n.div({ desc: [
				n.h5({ text: 'Blacklist', desc: [
					n.a({ class: 'searchhelp', html: '&nbsp; (help)', target: '_blank', href: 'https://raw.githubusercontent.com/index-eaw/artist-basis/master/img/blacklist_help.png' })
				] }),
				blSection,
				blSaveElem = n.div({ class: 'inactive', id: 'eabSave', text: 'Save' }),
				n.div({ desc: [
					n.input({ type: 'checkbox', id: 'blackhole', name: 'blackhole' }),
					n.label({ for: 'blackhole', text: 'Blackhole posts' })
				] })
			] });
		},
		
		search : () => n.div({ id: 'eabSearch', desc: [
			n.h5({ text: 'Search' }),
			getId('searchform').lastElementChild
		] }),
		
		options : () => n.div({ desc: [
			n.h5({ text: 'Options' })
		] }),
		
		misc : () => n.div({ desc: [
			n.h5({ text: 'Miscellaneous' }),
			n.div({ desc: [
				n.a({ href: 'https://e621.net/forum/show/260782', text: 'Give feedback' }),
				helpSpan('If you like this script, please leave a comment in my thread! Your feedback is the only way I know if I should maintain and improve the tool.\n\nSuggestions and ideas are very welcome as well.')
			] }),
			n.div({ desc: [
				backupLink = n.a({ href: 'javascript:void(0);', text: 'Create backup' })
			] }),
			n.div({ desc: [
				n.a({ href: 'javascript:void(0);', text: 'Clear cache', onclick: function() {
					clearStorage();
					storage('eabInvalidateCache', 'true');
					eabRefresh();
				} })
			] })
		] })
	};
	
	let eabLayout = parts => n.frag({ desc: [
		postList = n.div({ id: 'post-list', class: 'eab', desc: [
			sidebar = n.div({ class: 'sidebar', desc: parts.map( part => layout[part]() ) }),
			gallery = n.div({ class: 'content-post' })
		] }), n.div({ class: 'Clear' })
	] });
	
	if (roles.length === 0) return;
	if (roles.includes('watchlist')) preInitWatchlist();
	if (!loggedIn) quit('Error: not logged in.');
	
	function preInitWatchlist() {
		document.title = `Artist Watchlist - ${host.substr(0,4)}`;
		subnav.insertBefore(n.subnav('', 'List'), subnav.firstChild);
		
		content.innerHTML = '';
		content.appendChild( eabLayout(['status', 'manage', 'blacklist', 'misc']) );
	}
	
	
	//}-------------------//
	//-- Initialization -//{
	//--------------------//
	let artists, watch = [ ], oWatch, layers;
	
	function init() {
		prefs = JSON.parse(storage('eabPrefs'));

		// refresh when preferences are changed within the current window
		window.addEventListener('storage', (event) => {
			if (event.key.substr(0,3) === 'eab' && event.oldValue !== null) eabRefresh();
		});

		// backward compatibility
		if (typeof prefs.watchlist === 'string') prefs.watchlist = JSON.parse(prefs.watchlist);  // pre-1.2?
		if (typeof prefs.watchlist === 'array' && !prefs.cache) prefs.cache = {};  // pre-1.1
		if (prefs.cache) {  // pre-1.4
			prefs.watchlist = assembleCache(prefs.watchlist, prefs.cache);
			delete prefs.cache;
		}
		
		// form watchlist from cache
		Object.keys(prefs.watchlist).forEach(name => {
			let place = prefs.watchlist[name].n;
			watch[place] = name;
		});
		
		// and the rest
		bl = prefs.blacklist;
		oWatch = watch.slice();   // replicate
		artists = watch;
		
		if (roles.includes('watchlist')) initWatchlist();
		if (roles.includes('artistTags')) initArtistTags();
		if (roles.includes('favlist')) initFavlist();
		if (roles.includes('gallery')) initGallery();
	}
	
	
	function initLayout() {
		layers = [
			...layers, 
			{ id: 'None', desc: 'No posts found', append: helpSpan('Possible causes:\n * all posts blacklisted\n * artist has gone DNP\n * invalid artist name\n * you\'re on e926 and no safe posts exist') },
			{ id: 'Waiting', desc: 'Waiting' }
		];
		
		layers.forEach(layer => {
			gallery.appendChild(n.div({ class: 'eabLayer', id: `eabLayer${layer.id ? layer.id : layers.indexOf(layer)}`, desc:
				n.div({ html: layer.desc, ...layer.append && { desc: layer.append } })
			}) );
		});
		gallery.appendChild(n.div({ class: 'Clear' }));
		posts = gallery.childNodes;
		
		backupLink.addEventListener('click', async () => {
			await request('GET', 'set', '/set/index.json', `?user_id=${storage('eabUserId')}&post_id=65067`);
			saveFile(xhr('set').response[0].description);
		} );
		
		blSection.removeChild(blSection.firstElementChild);
		for (let tag in bl) blItem(tag, bl[tag]);
		blItem('', 'sqe');
	}
	
	async function initWatchlist() {
		manageField.addEventListener('keydown', (e) => manage(e), false);
		
		if (prefs.time) {
			// backwards compatibility: pre-1.4
			if ( !Array.isArray(prefs.time) ) prefs.time = [ prefs.time, prefs.time ];
			
			lastSaved -= prefs.time[0];
			lastVisit -= prefs.time[1];
			
			cooldown = (lastSaved/60 < timeout['cache']);
			if ( !cooldown ) lastVisit = lastSaved;
		}
		
		layers = [
			{ time: lastVisit, desc: 'Since last visit' },
			{ time: 60*60*24*7, desc: 'Past week' },
			{ time: 60*60*24*30, desc: 'Past month' },
			{ time: 60*60*24*365, desc: 'Past year' },
			{ time: 60*60*24*365*100, desc: 'Older than a year' },
		].filter( layer => (layer.time >= lastVisit) || layer.id );
		
		initLayout();
		await checkChanges();
		if (cooldown) ncLog = JSON.parse(storage('eabNcLog')) || { };
		
		oWatch.forEach(artist => {
			if (prefs.watchlist[artist].i && !storage('eabInvalidateCache')) {
				let info = prefs.watchlist[artist];
				
				if (Array.isArray(info.t)) info.t = info.t[0];  // backwards compatibility: pre-1.4
				info = { ...info };   // replicate
				
				if ( cooldown && (!isNew(info.t) || ncLog[artist]) ) artists.splice(artists.indexOf(artist), 1);   // don't update
				else info.class = 'eabFade';   // do update
				
				logItem( info.t, artist, info );
				if ( cooldown && isNew(info.t) && ncLog[artist] ) ncDisp(artist);
				
				log.set('action', 'Cached results shown.');
				
			} else {
				let info = { i: [150, 100], t: 0 };   // placeholders
				getId(`eabLayerWaiting`).style.display = 'block';
				gallery.insertBefore( newItem(artist, info, 'waiting...'), gallery.lastElementChild );
			}
		});

		xhr('posts').onload = watchlist;
		getPosts();
	}
	
	
	function initArtistTags() {
		let artistTags = sidebars[0].getElementsByClassName('tag-type-artist');

		for (let i = 0; i < artistTags.length; i++) {
			let atDesc = artistTags[i].children;
			let artist = atDesc[atDesc.length - 2].innerHTML.replace(/ /g, '_');
			if (!notArtists.includes(artist)) artistTags[i].appendChild(eabHeart(artist, `tagList_${artist}`));
		}
	}
	
	
	function initFavlist() {
		let mode = getId('mode');
		if (!mode) return;
		
		mode.insertBefore( n.option({ value: 'artist-watchlist', text: 'View artists' }), mode.childNodes[2] );
		mode.onchange = function() {
			if (this.value === 'artist-watchlist') {
				mode.value = 'view'; window.PostModeMenu.change(); mode.value = 'artist-watchlist'; // reset
				mode.disabled = true;
				let paginator = getId('paginator').getElementsByClassName('current')[0];
				let page = (paginator) ? paginator.innerHTML : '1';
				
				xhr('posts').onload = favlist;  // ALERT changed
				request('GET', 'posts', '/post/index.json', `?tags=${searchTags}&page=${page}`);
			} else window.PostModeMenu.change();
		};
	}
	
	
	function initGallery() {
		let lineItems = getCss('table td:nth-child(2) a'), lineList = [];
		lineItems.forEach(item => lineList.push(item.textContent));
		artists = lineList;
		
		let temp = eabLayout(['status', 'blacklist', 'search', 'misc']);
		temp.appendChild( getId('paginator') );
		content.innerHTML = '';
		content.appendChild( temp );
		
		layers = [
			{ time: 0, desc: 'List' }
		];
		initLayout();
		
		artists.forEach(artist => {
			if (false && !storage('eabInvalidateCache')) {
				/*let info = prefs.watchlist[artist];
				
				if (Array.isArray(info.t)) info.t = info.t[0];  // backwards compatibility: pre-1.4
				info = { ...info };   // replicate
				
				if ( cooldown && (!isNew(info.t) || ncLog[artist]) ) artists.splice(artists.indexOf(artist), 1);   // don't update
				else info.class = 'eabFade';   // do update
				
				logItem( info.t, artist, info );
				if ( cooldown && isNew(info.t) && ncLog[artist] ) ncDisp(artist);
				
				log.set('action', 'Cached results shown.');*/
				
			} else {
				let info = { i: [150, 100], t: 0 };   // placeholders
				getId(`eabLayerWaiting`).style.display = 'block';
				gallery.insertBefore( newItem(artist, info, 'waiting...'), gallery.lastElementChild );
			}
		});

		xhr('posts').onload = watchlist;
		getPosts();
	}
	
	
	//}-------------------//
	//-- Post search ----//{
	//--------------------//
	function favlist() {
		let data = xhr('posts').response;
		content.className = 'eab favlist';

		data.forEach(item => {
			let postCont = getId('p' + item.id);
			if (!postCont) return;
			postCont.onclick = '';
			let post = postCont.firstChild;

			postCont.lastChild.remove();
			post.style.width = pWidth(item.preview_width);

			item.artist.forEach(artist => {
				if (!notArtists.includes(artist)) postCont.appendChild( newItemLinks(artist, item.id, pWidth(item.preview_width)) );
			});

			if (postCont.childElementCount === 1) post.appendChild(n.span({ class: 'post-score eabGray', text: 'unknown' }));
		});
		
		postList = getId('post-list');
	}
	
	let blRecord = [];
	let retryCounter = 0, pLim, s, ncList;
	function watchlist() {
		let data = xhr('posts').response, p = 0;
		retryCounter--;
		
		ncList = [];
		data.forEach(item => {
			// which item in the artist list corresponds to this post?
			let i = artists.findIndex(name => item.artist.includes(name));
			
			let itemTags = item.tags.split(' ');
			let blacklisted = Object.keys(prefs.blacklist).some(blTags => {
				if (!prefs.blacklist[blTags].includes(item.rating)) return false;
				else return blTags.split(' ').every(tag => {
					if (tag.charAt(0) === '-') return (!itemTags.includes(tag.substr(1)));
					else return (itemTags.includes(tag));
				});
			});
			
			if (blacklisted) blRecord.push(item.md5);
			
			// stop if artists processed === artists searched
			if (p === s && !isNew(item.created_at.s)) return;
			p++;
			
			// a post appeared which doesn't match the search - there must be an alias
			// alert - what if aliased after added
			if ( i === -1 && pLim === 1 ) {
				request('GET', 'artist', '/artist/index.json', `?name=${artists[0]}`).then(alias);
				log.hide('action');  log.set('notice', 'Checking for alias...');
				xhr('artist').subject = artists.splice(0, 1)[0];
				
			} else if ( i > -1/* && !blacklisted*/ ) {
				insertItem( item, artists.splice(i, 1)[0] );
				
			} else p--;
			
			// display/update counter for all new posts
			if ( isNew(item.created_at.s) && roles.includes('watchlist') ) {
				item.artist.forEach(artist => {
					if (notArtists.includes(artist)) return;
					if (!ncList.includes(artist)) ncList.push(artist);
					
					ncUpdate(artist, item);
				});
				
				// if too many new posts - display '+' for all
				if (data.indexOf(item) === data.length - 1) {
					ncList.forEach( artist => ncUpdate(artist, '+') );
				}
			}
		});
		
		// nothing found
		if (data.length === 0) {
			if (pLim === 1) {	// for an artist input
				log.set('action', `No artist called '${artists[0]}'`);
				artists.splice(0, 1);
				return;
			} else missingItem();
			
		// something found, but nothing processed - either blacklisted or a multi-part search with an alias
		// try again, 1 at a time, for all parts of input (using retryCounter)
		} else if (p === 0) {
			if (s > 1) retryCounter = pLim;
			else missingItem();
		}
		
		if (retryCounter > 0 && artists.length > 0) getPosts(1);
		else if (artists.length > 0) getPosts();
		else {
			if (!roles.includes('watchlist')) return log.set('action', 'Done!');
			
			prefs.time = [ now(), prefs.time[0] ];
			if (ncLog) storage('eabNcLog', ncLog);
			
			if (!cooldown) saveChanges();
			else log.set('action', 'Done!');
		}
	}
	
	let formerTags, permit = { };
	function getPosts(lim = tagLim[host]) {
		if (artists.length === 0) return;
		let tags = '';
		
		if (roles.includes('gallery')) {
			lim--;
			tags += `order:${priority} `;
		}
		
		let top = artists[0];
		// each tag is permitted 3 searches - if nothing found, it's probably just slowing things down, try searching it alone
		let exhausted = (permit[top] && permit[top] >= 3);
		// same if no posts were recorded last time (alert)
		let noPosts = (roles.includes('watchlist') && prefs.watchlist[top].t && prefs.watchlist[top].t[0] === 0);
		
		if (exhausted || noPosts) {
			tags = top;
			s = 1;
			
		} else for (s = 0; s < artists.length && s < lim; s++) {
			if (artists[s].charAt(0) === '-' || artists[s].length === 0) return artists.splice(s, 1);   // remove useless tags
			if (artists.length !== 1 && lim !== 1) tags += '~';
			tags += artists[s] + ' ';
			
			if (permit[artists[s]]) permit[artists[s]]++;
			else permit[artists[s]] = 1;
		}
		
		// alert: if post older than x, remove?
		if (s !== 1) tags += `&limit=${s*ppa}`;   // slows search down w/ 1 tag
		if (tags === formerTags) quit(`Error: loop detected on search query '${tags}'`);
		formerTags = tags;
		
		pLim = lim;
		request('GET', 'posts', '/post/index.json', `?tags=${tags}`);
		log.set('action', 'Requesting posts...');
	}
	
	
	//}-------------------//
	//-- Post handling --//{
	//--------------------//
	let times = [], ncOffset = {};
	function logItem(time, artist, ...niArgs) {
		times.push(time);
		times.sort().reverse();
		
		let place = times.indexOf(time);
		sorted.splice(place, 0, artist);
		
		let offset = 0;
		for (let i = 0; i < place; i++) offset += ncOffset[sorted[i]] || 0;
		
		let layer = 0;
		if (time === 0) layer = 'None';
		else layers.forEach(a => { if (a.time && (now() - time) > a.time) layer++; });
		
		getId(`eabLayer${layer}`).style.display = 'block';
		
		if (time === 0) layer = layers.map(l => l.id).indexOf('None');
		gallery.insertBefore( newItem(artist, ...niArgs), posts[place + layer + offset + 1] );
	}
	
	let newItemLinks = (artist, heartId, width) =>
		n.span({ class: 'post-score', style: `width: ${width}`, desc: [
			eabHeart(artist, `${heartId}_${artist}`),
			n.a({ class: 'eabWiki', href: `/artist/show?name=${artist}`, text: '?' }),
			n.a({ href: `/post?tags=${artist}`, desc: [ n.span({ text: artist.replace(/_/g, ' '), title: artist }) ] })
		] }
	);
	
	function newItem(artist, info, dText = '', alt = '') {
		let iSrc = `${window.location.protocol}//static1.${window.location.host}/`;
		let md5 = info.i[2] || false;
		
		if (!md5) iSrc = '';
		else if (md5.length === 32) {
			if (blRecord.includes(md5)) iSrc += '/images/blacklisted-preview.png';
			else if (info.flash) iSrc += 'images/download-preview.png';
			else iSrc += `data/preview/${md5.substring(0,2)}/${md5.substring(2,4)}/${md5}.jpg`;
		
		// backward compatibility: pre-1.4
		} else if (md5.includes('download-preview.png')) {
			iSrc += 'images/download-preview.png';
			md5 = false;
		} else if (md5.includes('/')) {
			iSrc += `data/preview/${md5}`;
			md5 = md5.split('/').pop().replace('.jpg', '');
		}
		
		if (info.t === 0) dText = 'missing';
		else {
			let date = new Date(info.t*1000);
			dText = `${('0' + date.getDate()).slice(-2)} ${date.toLocaleString('en-us',{month:'short'})} <span class='eabFade'>${date.getFullYear()}</span>`;
		}
		
		let dims = (blRecord.includes(md5)) ? [150, 150] : info.i;
		
		return n.span({ id: info.id || `ab-${artist}`, class: `thumb ${info.class || ''}`, 'data-time': info.t, desc:
			n.span({ style: `width: ${pWidth(dims[0])}`, desc: [
				n.a({ ...md5 && { href: `/post/show?md5=${md5}` }, desc: [
					n.img({ class: 'preview', alt, title: alt, src: iSrc, width: dims[0], height: dims[1] })
				] }),
				... (info.class && info.class === 'slave') ? [] : [ newItemLinks( artist, 'heart', '' ) ],
				n.a({ href: `/post?tags=${artist}`, class: 'post-score post-date', html: dText })
			] })
		});
	}
	
	let alt = (item, artist) => `${item.tags} \n\nArtist: ${artist} \nRating: ${{'s':'Safe','q':'Questionable','e':'Explicit'}[item.rating]} \nScore: ${item.score} \nFaves: ${item.fav_count}`;
	function insertItem(item, artist) {
		let info = {
			i: [ item.preview_width, item.preview_height, item.md5 ],
			t: item.created_at.s
		};
		if (item.file_ext === 'swf') info.flash = true;
		
		removeItem(artist);
		prefs.watchlist[artist] = info;
		
		logItem( item.created_at.s, artist, info, '', alt(item, artist) );
	}
	
	function removeItem(artist) {
		if (artists.includes(artist)) artists.splice(artists.indexOf(artist), 1);
		let prior = sorted.indexOf(artist);
		if (prior > -1) {
			sorted.splice(prior, 1);
			times.splice(prior, 1);
		}
		
		let existing = getId(`ab-${artist}`);
		if (existing) {
			// if we're surrounded by layer divs, this is the last item in the layer and it can be hidden
			let last = ![existing.nextElementSibling.tagName, existing.previousElementSibling.tagName].includes('SPAN');
			if (last) existing.previousElementSibling.style.display = 'none';
			
			existing.remove();
		}
	}
	
	function missingItem() {
		let artist = artists.splice(0, 1)[0];
		removeItem(artist);
		
		let info = { i: [150, 100], t: 0 };
		prefs.watchlist[artist] = info;
		logItem( 0, artist, info, 'missing' );
	}
	
	
	//}-------------------//
	//-- New counter ----//{
	//--------------------//
	let ncLog = {};
	function ncUpdate(artist, add) {
		if (!ncLog[artist]) ncLog[artist] = { master: add.id };
		
		if (typeof add === 'string') ncLog[artist].append = add;
		else {   // guard against the possibility of collabs being counted twice
			if (Object.keys(ncLog[artist]).includes(add.id)) return;
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
			ab.appendChild(nc);
		}
		
		if (!nc.onclick && (ncLog[artist].append || ncValue > 1)) {
			toggle(nc, 'expand');
			
			nc.onclick = function() {
				let expanded = getClass('collapse');
				if (expanded.length > 0 && nc.className.includes('expand')) toggleMaster(expanded[0], expanded[0].id.substring(3));
				
				toggleMaster(nc, artist);
				if (ncLog[artist].append) fullSearch(artist, 1);
			};
		}
	}
	
	function toggleMaster(nc, artist) {
		toggle(nc, 'expand', 'collapse');
		toggle(postList, 'highlight');
		ncToggle(artist);
	}
	
	function ncItem(artist, id, insertPoint) {
		let item = ncLog[artist][id];
		
		let info = {
			i: [ item.preview_width, item.preview_height, item.md5 ],
			t: item.created_at.s,
			flash: (item.file_ext === 'swf'),
			class: 'slave',
			id: `abs-${id}`
		};
		
		let elem = newItem(artist, info, '', alt(item, artist));
		gallery.insertBefore(elem, insertPoint);
		ncOffset[artist]++;
		
		return elem;
	}
	
	function ncToggle(artist, state) {
		let ab = getId(`ab-${artist}`);
		let expanded = state || toggle(ab, 'slave');
		
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
		await request('GET', 'nc', '/post/index.json', `?tags=${artist}&page=${page}`);
		let data = xhr('nc').response, clear = true;
		
		data.forEach(item => {
			// display all new posts
			if (!isNew(item.created_at.s) || ncLog[artist][item.id] || !item.artist.includes(artist)) return;
			
			ncUpdate(artist, item);
			
			// if too many new posts - continue searching
			if (data.indexOf(item) === data.length - 1) {
				fullSearch(artist, page + 1);
				clear = false;
			}
		} );
		
		if (clear) ncUpdate(artist, '');  // clear append
		ncToggle(artist, true);
	}
	
	
	//}-------------------//
	//-- Management -----//{
	//--------------------//
	let purge = [], sorted = [], prefs, directory = {};
	let heartClass = (artist) => ((artists.includes(artist) || sorted.includes(artist)) && !purge.includes(artist)) ? 'eabHeart eabFav' : 'eabHeart';
	
	function eabHeart(artist, id) {
		if (directory[artist]) directory[artist].push(id);
		else directory[artist] = [ id ];

		return n.span({ id, onclick: heartToggle, class: heartClass(artist), 'data-artist': artist, text: '♥ ' });
	}
	
	function heartToggle() {
		let artist = this.getAttribute('data-artist');
		
		if (artists.includes(artist)) artists.splice(artists.indexOf(artist), 1);
		else if (!sorted.includes(artist)) artists.splice(0, 0, artist);
		
		// if it's already been rendered and sorted, leave it alone for now, but don't save it later
		if (purge.includes(artist)) purge.splice(purge.indexOf(artist), 1);
		else if (sorted.includes(artist)) purge.splice(0, 0, artist);
		
		directory[artist].forEach(id => { getId(id).className = heartClass(artist) + ' eabFade'; });
		
		saveChanges(function () {
			directory[artist].forEach(id => {
				getId(id).className = heartClass(artist);
			});
		});
	}

	function duplicate(artist) {
		log.hide('action'); log.unhide('det');
		log.set('resolution', `remove '${artist}'?`);
		log.det.onclick = function() { 
			log.hide('det'); log.unhide('action'); log.reset();
			removeItem(artist);
			if (artists.length === 0) saveChanges();
		};
	}

	function alias() {
		if (xhr('artist').response.length === 0) {
			log.reset();
			log.set('notice', `No artist called '${xhr('artist').subject}'`);
		} else {
			let artist = xhr('artist').response[0].name;

			log.hide('action');
			log.set('notice', `'${xhr('artist').subject}' is an alias,`);
			log.set('resolution', `replaced with '${artist}'.`);

			if (artists.includes(artist) || sorted.includes(artist)) return duplicate(artist);
			artists.splice(0, 0, artist);
			getPosts(1);
		}
	}

	function manage(e) {
		if (e.keyCode !== 13) return;
		let artist = manageField.value.replace(/ /g, '_');

		manageField.value = '';
		log.hide('det'); log.unhide('action');
		log.reset();
		formerTags = null;

		if (artists.includes(artist) || sorted.includes(artist)) return duplicate(artist);
		artists.splice(0, 0, artist);
		getPosts(1);
	}
	
	
	//}-------------------//
	//-- Communication --//{
	//--------------------//
	let setDesc = () => 'This private set contains your configuration of the \nArtist Watchlist script. It is used so your list can be\npermanently stored between sessions. If this set\nis tampered with, the script may malfunction.\n\n' + LZString.compressToUTF16(JSON.stringify(prefs));
	
	function request(method, page, url, data) {
		return new Promise( function(resolve, reject) {
			xhr(page).onreadystatechange = function() {
				if ( xhr(page).readyState !== 4 ||  xhr(page).status === 0) return;
				if ( xhr(page).status >= 200 && xhr(page).status < 300 ) resolve();
				else quit(`Server error: ${xhr(page).status} on ${xhr(page).responseURL}`);
			};
			
			let form = (typeof data === 'string') ? null : new FormData();

			if (typeof data === 'string') url += data;
			else for (let part in data) form.append(part, data[part]);

			if (roles.includes('dev')) console.log(`Requesting ${window.location.origin + url}`);
			xhr(page).open(method, encodeURI(window.location.origin + url), true);
			xhr(page).setRequestHeader('User-Agent', `Artist_Basis/${GM_info.script.version}`);
			xhr(page).responseType = 'json';
			xhr(page).send(form);
		});
	};
	
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
		//manageField.disabled = true;
		quit('Reloading');
	}
	
	function assembleCache(list, temp) {
		let cache = { }, place = 0;
		
		list.forEach(artist => {
			if (temp[artist]) cache[artist] = { ...temp[artist] };
			else cache[artist] = { };
			cache[artist].n = place++;
		});
		
		return cache;
	}
	
	// check for more recent changes if preferences were recorded for this session more than x min ago
	async function checkChanges() {
		if ((now() - storage('eabTime'))/60 > timeout['storage']) {   // ALERT
			let storedPrefs = storage('eabPrefs');
			await getPrefs();
			if (storedPrefs !== storage('eabPrefs')) eabRefresh();
		}
		
		return Promise.resolve();
	}

	async function saveChanges(callback) {
		log.set('action', 'Saving watchlist...');
		
		// combine sorted and artists, remove duplicates and unfavorited
		let list = [...new Set([...sorted, ...artists])].filter(artist => !purge.includes(artist));
		prefs.watchlist = assembleCache(list, prefs.watchlist);
		
		await checkChanges();
		let compressed = setDesc();
		
		// ATTENTION
		// limit: 10,000 chars UTF-16, one compressed cache entry is about 26 chars
		while (compressed.length > 10000) {
			let remove = Math.ceil((compressed.length - 10000)/24);
			
			for (let i = 0; i < remove; i++) delete prefs.cache[sorted[sorted.length - 1]];
			compressed = setDesc();
		}
		
		console.log(prefs);
		await request('POST', 'update', '/set/update.json', {'set[description]':compressed,'set[id]':storage('eabSetId')});
		
		storage('eabPrefs', JSON.stringify(prefs));
		storage('eabTime', now());

		if (callback) callback();
		if (storage('eabInvalidateCache')) localStorage.removeItem('eabInvalidateCache');
		log.set('action', 'Done!');
	}
	
	
	//}-------------------//
	//-- Storage --------//{
	//--------------------//
	function storage(key, val) {
		if (!val) return localStorage.getItem(key);
		if (typeof val === 'object') val = JSON.stringify(val);
		localStorage.setItem(key, val);
		if (roles.includes('dev')) console.log(`Setting ${key} as ${val}`);
	}
	
	function clearStorage() {
		Object.keys(localStorage).forEach(key => {
			if (key.substr(0,3) === 'eab' && key !== 'eabInvalidateCache') localStorage.removeItem(key);
		});
	}
	
	function saveFile(data) {
		let blob = new Blob([data], {type: 'text/plain;charset=utf-8'});
		let link = window.URL.createObjectURL(blob);
		
		let a = n.a({ style: 'display:none', href: link, download: `e621_watchlist_backup ${new Date().toUTCString().slice(5)}.txt` });
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(link);
	}
	
	// STEP 0 -- if login or version has changed, invalidate storage (alert for dan)
	if (storage('eabUserName') !== cookie.login || storage('eabVersion') !== GM_info.script.version) clearStorage();
	storage('eabVersion', GM_info.script.version);
	
	// STEPS 1-2 -- get user info, then prefs
	async function getPrefs() {
		await request('GET', 'set', '/set/index.json', `?user_id=${storage('eabUserId')}&post_id=65067`);
		if ((xhr('set').response.length) === 0) return firstTime();  // ALERT
		
		storage('eabTime', now());
		storage('eabSetId', xhr('set').response[0].id);
		
		let eabPrefs = xhr('set').response[0].description.split('\n')[5];
		
		if (eabPrefs.substr(0,2) !== '{"') eabPrefs = LZString.decompressFromUTF16(eabPrefs);  // backward compatibility pre-1.3
		else if (!storage('eabNoBug')) {
			storage('eabNoBug', 'true');
			alert('e621 Artist Watchlist has received a major update.\nYou will be prompted to save a backup of your watchlist\nso it can be restored if something goes wrong.');
			saveFile(xhr('set').response[0].description);
		}
		
		storage('eabPrefs', eabPrefs);
		Promise.resolve();
	}
	
	if (storage('eabPrefs') && storage('eabUserId')) init();
	else {
		await request('GET', 'user', '/user/show.json', '');
		storage('eabUserName', xhr('user').response.name);
		storage('eabUserId', xhr('user').response.id);

		getPrefs().then(init);
	}
	
	// STEP 3 -- first-time setup if necessary
	async function firstTime() {
		log.set('action', 'First-time setup...');
		let name = 'artist_watchlist__' + Math.random().toString(36).substr(2, 10);

		prefs = { 'watchlist': [], 'blacklist': {}, 'cache': {} };
		await request('POST', 'create', '/set/create.json', {'set[name]':name, 'set[shortname]':name, 'set[public]':'false', 'set[description]': setDesc()});
		
		storage('eabTime', now());
		storage('eabSetId', xhr('create').response.set_id);
		storage('eabPrefs', JSON.stringify(prefs));
		
		await request('POST', 'add', '/set/add_post.json', `?set_id=${storage('eabSetId')}&post_id=65067`).then(init);
		log.set('action', 'Ready! Add an artist below.');
	} //}

});