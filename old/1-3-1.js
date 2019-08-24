// ==UserScript==
// @name         Artist Watchlist
// @description  Follow posts from your favorite artists!
// @namespace    https://e621.net/artist/watchlist
// @version      1.3.1
// @author       index
// @license      GPL-3.0-or-later
// @match        *://*.e621.net/*
// @match        *://*.e926.net/*
// @updateURL    https://openuserjs.org/meta/index-eaw/Artist_Watchlist.meta.js
// @downloadURL  https://openuserjs.org/install/index-eaw/Artist_Watchlist.user.js
// @require      https://raw.githubusercontent.com/pieroxy/lz-string/master/libs/lz-string.min.js
// ==/UserScript==

// GreaseMonkey fix - globalize access to the native e621 mode menu
try {
	if (PostModeMenu) window.PostModeMenu = PostModeMenu;
} catch (error) {
	if (!window.PostModeMenu) window.PostModeMenu = window.wrappedJSObject['PostModeMenu'];
}

(function() {
	//-------------------//
	//-- General -------//{
	//-------------------//
	"use strict";
	let notArtists = [ 'unknown_artist', 'unknown_artist_signature', 'unknown_colorist', 'avoid_posting', 'conditional_dnp', 'sound_warning', 'epilepsy_warning' ],
	    tagLim = { 'e621.net': 6, 'e926.net': 5 },
	    timeout = { 'cache': 60, 'storage': 1 },   // in minutes
	    currentVersion = '1.3.0', devMode = false, noThumbs = false;

	let log, xhr = { };
	function quit(msg) {
		if (log) log.set('action', msg);
		for (let page in xhr) xhr[page].abort();
		throw new Error(msg);
	}

	document.addEventListener('keydown', (e) => { if (e.keyCode === 27) quit('Halted with Esc key.'); });
	delete Array.prototype.toJSON;

	// node creator
	let n = {
		elem: (elem, obj) => {
			for (let prop in obj) {
				if (prop === 'desc') obj.desc.forEach(child => { elem.appendChild(child); });
				else if (prop === 'text') elem.appendChild(n.text(obj[prop]));
				else if (prop === 'html') elem.innerHTML = obj[prop];
				else if (prop.substr(0,2) === 'on') {
					if (obj[prop][0]) obj[prop].forEach(func => {
						elem.addEventListener(prop.substr(2), func);
					});
					else elem.addEventListener(prop.substr(2), obj[prop]);
				} else elem.setAttribute(prop, obj[prop]);
			}
			return elem;
		},
		text: cont => document.createTextNode(cont),
		frag: obj => n.elem(document.createDocumentFragment(), obj)
	};

	['div', 'span', 'a', 'img', 'li', 'h5', 'style', 'input', 'ul', 'option', 'br'].forEach(tag => {
		n[tag] = obj => n.elem(document.createElement(tag), obj);
	});

	let newLi = (page, text) => n.li({ desc: [
		n.a({ href:'/artist/' + page, text })
	] });
	
	let sorted = [], prefs;
	let heartClass = (artist) => ((artists.includes(artist) || sorted.includes(artist)) && !purge.includes(artist)) ? 'eabHeart eabFav' : 'eabHeart',
	    directory = {};

	function eabHeart(artist, id) {
		if (directory[artist]) directory[artist].push(id);
		else directory[artist] = [ id ];

		return n.span({ id, onclick: heartToggle, class: heartClass(artist), 'data-artist': artist, text: '♥ ' });
	}
	
	let sidebars = document.getElementsByClassName('sidebar'),
	    searchTags, roles = [];
	
	if (window.location.pathname.substr(0,17) === '/artist/watchlist') roles.push('watchlist');
	if (sidebars.length > 0) roles.push('favorites');
	if (document.getElementById('tags')) {
		roles.push('favlist');
		searchTags = decodeURIComponent(window.location.href.split('/').pop().split('=').pop());
		if (!isNaN(searchTags) || searchTags === 'index') searchTags = '';
	}
	
	
	//}------------------//
	//-- Style ---------//{
	//-------------------//
	let styleElem, style, scheme, colors = {
		middle: 33,  dark: 30,  darker: 25,  darkest: 15,
		'hexagon':                    'hsla(217,  53%, &V%, &O%)',
		'hexagon,skin-pony':          'hsla(268,  53%, &V%, &O%)',
		'hexagon,skin-bloodlust':     'hsla(  0,   0%, &V%, &O%)',
		'hexagon,skin-serpent':       'hsla(130,  80%, &V%, &O%)',
		'hexagon,skin-hexagon-clean': 'hsla(217,  53%, &V%, &O%)',
		'hexagon,skin-hotdog':        'hsla(360, 100%, &V%, &O%)'   // why?
	};
	
	scheme = document.getElementById('user_css').value;
	function hsl(variant, opacity = 100) {
		return colors[scheme].replace('&V', colors[variant]).replace('&O', opacity);
	}
	
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
			border: 1px solid ${hsl('darkest')};
			border-radius: 4px;
			box-shadow: none;
		
		} .eab span.thumb {
			height: inherit;
			margin: 1em 0;
		} .eab img.preview {
			border: 1px solid ${hsl('darkest')};
			border-radius: 4px 4px 0 0;
			background: ${hsl('dark')};
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
		
		} .eab .post-score {
			background-color: ${hsl('middle')};
			color: #FFF;
			border-radius: 0;
			display: block;
			width: inherit;
			border: 1px solid ${hsl('darkest')};
			border-width: 0 1px 1px;
		} .eab .post-score .eabHeart, .eab .post-score .eabWiki {
			float: left;
			width: 0;
			padding: 0;
			transition: all 0.15s linear;
			opacity: 0;
			border: none;
		} .eab .thumb:hover .eabHeart, .eab .thumb:hover .eabWiki {
			padding: 0 5px;
			width: initial;
			opacity: 1;
			border-right: inherit;
		} .eab .post-score:last-child {
			border-radius: 0 0 4px 4px;
		} .eab .post-date {
			background: ${hsl('dark')};
			font-size: 7pt;
			line-height: 10pt;
		} .post-date .eabFade {
			padding-left: 0.5ex;
		} .eab .post-score:not(.post-date) {
			line-height: 1rem;
		
		} .favlist .eabGray {
			color: #AAA;
			cursor: default;
			font-style: italic;
		} .favlist .post-score a:last-child, .favlist .post-score a:last-child:hover {
			color: #FFF;
			display: block;
			width: 100%
		
		} .eabLayer, .eabLayer div {
			border-radius: 3px;
			color: #FFF;
			text-shadow: 0 0 3px #000;
			font-size: 10.5pt;
			border: 1px solid;
			border-width: 1px 0 1px 1px;
		} .eabLayer {
			margin-top: 1.5em;
			display: none;
			border-image: linear-gradient(to right, rgba(0,0,0,0.5), rgba(0,0,0,0.3) 40%, rgba(0,0,0,0) 90%, rgba(0,0,0,0)) 1;
		} .eabLayer > div {
			padding: 0.2em 0.8em 0.3em;
			background: linear-gradient(to right, ${hsl('darker')}, ${hsl('darker',80)} 40%, ${hsl('darker',0)} 90%);
			border-image: linear-gradient(to right, ${hsl('middle')}, ${hsl('middle',80)} 40%, ${hsl('middle',0)} 90%) 1;
		} .eab .content-post {
			margin-top: -1.5em;
		
		} #eabBlacklist {
			width: 189px;
			margin: 2px 0 0 0;
		} #eabSave {
			cursor: pointer;
			color: #FFF;
			text-shadow: 0 0 3px #000;
			text-align: center;
			background: ${hsl('middle')};
			border-radius: 4px;
			border: 1px solid ${hsl('darkest')};
			width: 187px;
			padding: 0.1ex 0 0.2ex;
			margin: 2px 0 1ex;
			line-height: 11.5pt;
		} #eabSave, #eabBlacklist div:not(:last-child) {
			-moz-user-select: none;
			-webkit-user-select: none;
		} #eabSave:active {
			background: ${hsl('dark')};
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
			color: #FFF;
			text-shadow: 0 0 3px #000;
			width: 3ex;
			text-align: center;
		} #eabBlacklist div {
			background: ${hsl('middle')};
			border: 1px solid ${hsl('darkest')};
			border-width: 0 1px 1px 0;
			vertical-align: bottom;
			text-overflow: ellipsis;
			position: relative;
			z-index: 1000;
			font-size: 9pt;
			padding: 0.1ex 0 0.2ex;
		} #eabBlacklist div:not(:last-child).inactive, #eabSave.inactive {
			color: #BBB;
			background: ${hsl('darker')};
		} #eabBlacklist li:first-child div:last-child { border-top-left-radius: 4px; }
		#eabBlacklist li:first-child div:first-child { border-top-right-radius: 4px; }
		#eabBlacklist li:last-child div:last-child { border-bottom-left-radius: 4px; }
		#eabBlacklist li:last-child div:first-child { border-bottom-right-radius: 4px; }
	`;
	
	document.head.appendChild(styleElem = n.style({ text: style() }));
	document.getElementById('user_css').addEventListener('change', () => {
		scheme = event.target.value;
		styleElem.innerHTML = style();
	});
	
	
	//}------------------//
	//-- Blacklist -----//{
	//-------------------//
	let bl, blInputList, blSection, blSaveElem, blReady = true;
	if (roles.includes('watchlist')) {
		blInputList = document.getElementsByClassName('blInput');
		blSection = n.ul({ id: 'eabBlacklist' });
		
		document.addEventListener('click', blUnfocus);
	}
	
	let sb;
	function blItem(tag, ratings) {
		let li = n.li();
		
		['s','q','e'].forEach(c => {
			li.appendChild( n.div({ 'text': c, 'class': (ratings.includes(c)) ? 'active' : 'inactive', 'onclick': blRatingCycle }) );
		});
		
		li.appendChild(n.div({ 'data-ratings': ratings, 'class': 'blInput', 'text': tag, 'contenteditable': 'true', 'desc': [n.br()],
			'onfocus': blAdjust, 'oninput': [ blAdjust, blSaveCycle ], 'onkeypress': blEnter
		}) );
		
		blSection.appendChild(li);
		if (sb) console.log(sb.offsetHeight);
		if (sb && sb.offsetHeight > window.innerHeight) sb.style.position = 'initial';
	}
	
	function blUnfocus(e) {
		if (blSection !== e.target && !blSection.contains(e.target)) blSection.style.width = '189px';
		
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
		blSection.style.width = (width > 189) ? width + 'px' : '189px';
		
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
	
	
	//}------------------//
	//-- Page handling -//{
	//-------------------// 
	let content = document.getElementById('content'), gallery, manageField, backupLink, subnav, postList,
	    loggedIn = document.cookie.includes('login=');
	
	let helpSpan = (title) => n.span({ class: 'searchhelp', style: 'cursor:help', title, html: '&nbsp; (?)' });
	let layers = [
		{ time: 0, desc: 'Since last visit' },
		{ time: 60*60*24*7, desc: 'Past week' },
		{ time: 60*60*24*30, desc: 'Past month' },
		{ time: 60*60*24*365, desc: 'Past year' },
		{ time: 60*60*24*365*100, desc: 'Older than a year' },
		{ id: 'None', desc: 'No posts found', append: helpSpan('Possible causes:\n * aggressive blacklist\n * all posts were removed\n * invalid artist name\n * you\'re on e926 and no safe posts exist\n\nTo speed up the watchlist, removal is advised.') },
		{ id: 'Waiting', desc: 'Waiting' }
	];
	
	if (window.location.search === '?dev') devMode = true;
	if (window.location.pathname.substr(0,7) === '/artist') {
		subnav = document.getElementById('subnav').firstElementChild;
		subnav.appendChild(newLi('watchlist', 'Watchlist'));
	}

	log = {
		reset: () => { for (let line in log) if (line !== 'det') log[line].innerHTML = ''; },
		set: (line, txt) => { if (log[line]) log[line].innerHTML = txt; console.log(txt); },
		hide:     (line) => { if (log[line]) log[line].style.display = 'none'; },
		unhide:   (line) => { if (log[line]) log[line].style.display = ''; }
	};

	if (roles.includes('watchlist')) {
		document.title = `Artist Watchlist - ${window.location.host.substr(0,4)}`;
		subnav.insertBefore(newLi('', 'List'), subnav.firstChild);
		
		blItem('', 'sqe');
		
		content.innerHTML = '';
		content.appendChild(n.frag({ desc: [
			postList = n.div({ id: 'post-list', class: 'eab', desc: [
				sb = n.div({ class: 'sidebar', desc: [
					n.div({ desc: [
						n.h5({ text: 'Status' }),
						log.notice = n.div({ text: '' }),
						n.div({ desc: [
							log.det = n.a({ style: 'display: none', href: '#', text: 'Click to confirm: ' }),
							log.resolution = n.span({ text: '' })
						] }),
						log.action = n.div({ text: 'Requesting user data...' })
					] }),
					n.div({ desc: [
						n.h5({ text: 'Add/remove artist' }),
						manageField = n.input({ style: 'width:183px', type: 'text' })
					] }),
					n.div({ desc: [
						n.h5({ text: 'Blacklist', desc: [
							n.a({ class: 'searchhelp', html: '&nbsp; (help)', target: '_blank', href: 'https://raw.githubusercontent.com/index-eaw/artist-basis/master/img/blacklist_help.png' })
						] }),
						blSection,
						blSaveElem = n.div({ class: 'inactive', id: 'eabSave', text: 'Save' })
					] }),
					n.div({ desc: [
						n.h5({ text: 'Miscellaneous' }),
						n.div({ desc: [
							n.a({ href: 'https://e621.net/forum/show/260782', text: 'Give feedback' }),
							helpSpan('If you like this script, please leave a comment in my thread! Your feedback is the only way I know if I should maintain and improve the tool.\n\nSuggestions and ideas are very welcome as well.')
						] }),
						n.div({ desc: [
							backupLink = n.a({ href: '#', text: 'Create backup' })
						] }),
						n.div({ desc: [
							n.a({ href: '#', text: 'Clear cache', onclick: function() {
								clearStorage();
								storage('eabInvalidateCache', 'true');
								eabRefresh();
							} })
						] }),
					] })
				] }),
				gallery = n.div({ class: 'content-post' })
			] }), n.div({ class: 'Clear' })
		] }) );
		
		console.log(sb);
		
		layers.forEach(layer => {
			gallery.appendChild(n.div({ class: 'eabLayer', id: `eabLayer${layer.id ? layer.id : layers.indexOf(layer)}`, desc: [
				n.div({ html: layer.desc, desc: [ ... layer.append ? [ layer.append ] : [] ] })
			] }) );
		});
		gallery.appendChild(n.div({ class: 'Clear' }));
		
		if (loggedIn) manageField.addEventListener('keydown', (e) => manage(e), false);
	
	} else if (roles.length === 0) return;
	
	if (!loggedIn) quit('Error: not logged in.');


	//}------------------//
	//-- Initialization //{
	//-------------------//
	let artists, oArtists;
	
	function eabRefresh() {
		if (roles.includes('favorites')) {
			prefs = JSON.parse(storage('eabPrefs'));
			
			if (prefs) {
				artists = prefs.watchlist;
				let hearts = document.getElementsByClassName('eabHeart');
				for (let heart of hearts) heart.className = heartClass(heart.getAttribute('data-artist'));
				return;
			}
		}

		window.addEventListener('focus', () => { location.reload(); });
		if (document.hasFocus()) location.reload();
		//manageField.disabled = true;
		quit('Reloading');
	}

	function init() {
		prefs = JSON.parse(storage('eabPrefs'));

		// refresh when preferences are changed within the current window
		window.addEventListener('storage', (event) => {
			if (event.key.substr(0,3) === 'eab' && event.oldValue !== null) eabRefresh();
		});

		// backward compatibility
		if (typeof prefs.watchlist === 'string') prefs.watchlist = JSON.parse(prefs.watchlist);
		if (!prefs.cache) prefs.cache = {};
		
		if (prefs.time) layers[0].time = Date.now()/1000 - prefs.time;
		bl = prefs.blacklist;
		artists = prefs.watchlist;
		oArtists = artists.slice();   // replicate
		
		if (roles.includes('watchlist')) {
			
			backupLink.addEventListener('click', (e) => {
				e.preventDefault();
				httpRequest('GET', xhr.set, '/set/index.json', `?user_id=${storage('eabUserId')}&post_id=65067`, function() {
					saveFile(xhr.set.response[0].description);
				});
			} );
			
			blSection.removeChild(blSection.firstElementChild);
			for (let tag in bl) blItem(tag, bl[tag]);
			blItem('', 'sqe');
			
			checkChanges(function() {
				
				console.log(artists);
				oArtists.forEach(artist => {
					if (artist in prefs.cache && !storage('eabInvalidateCache')) {
						let info = prefs.cache[artist];
						if ((Date.now()/1000 - info.t[1])/60 < timeout['cache']) artists.splice(artists.indexOf(artist), 1);
						else info.class = 'eabFade';
						
						logItem( info.t[0], artist, info );
						log.set('action', 'Cached results shown.');
					} else {
						let info = { i: [150, 100], t: 0 };   // placeholders
						document.getElementById(`eabLayerWaiting`).style.display = 'block';
						gallery.insertBefore( newItem(artist, info, 'waiting...'), gallery.lastElementChild );
					}
				});

				xhr.posts.onload = watchlist;
				getPosts();
				
			});
			
		}

		if (roles.includes('favorites')) {
			content.className = 'favorites';
			let artistTags = sidebars[0].getElementsByClassName('tag-type-artist');

			for (let i = 0; i < artistTags.length; i++) {
				let atDesc = artistTags[i].children;
				let artist = atDesc[atDesc.length - 2].innerHTML.replace(/ /g, '_');
				if (!notArtists.includes(artist)) artistTags[i].appendChild(eabHeart(artist, `tagList_${artist}`));
			}
		}

		let mode = document.getElementById('mode');
		if (roles.includes('favlist') && mode) {
			mode.insertBefore( n.option({ value: 'artist-watchlist', text: 'View artists' }), mode.childNodes[2] );
			mode.onchange = function() {
				if (this.value === 'artist-watchlist') {
					mode.value = 'view'; window.PostModeMenu.change(); mode.value = 'artist-watchlist'; // reset
					mode.disabled = true;
					let paginator = document.getElementById('paginator').getElementsByClassName('current')[0];
					let page = (paginator) ? paginator.innerHTML : '1';

					httpRequest('GET', xhr.posts, '/post/index.json', `?tags=${searchTags}&page=${page}`);
					xhr.posts.onload = favlist;
				} else window.PostModeMenu.change();
			};
		}
	}


	//}------------------//
	//-- File search ---//{
	//-------------------//
	function favlist() {
		let data = xhr.posts.response;
		content.className = 'eab favlist';

		data.forEach(item => {
			let postCont = document.getElementById('p' + item.id);
			if (!postCont) return;
			postCont.onclick = '';
			let post = postCont.firstChild;

			postCont.lastChild.remove();
			post.style.width = item.preview_width + 'px';

			item.artist.forEach(artist => {
				if (notArtists.includes(artist)) return;

				postCont.appendChild(n.span({class: 'post-score', style: `width:${item.preview_width}px`, desc: [
					eabHeart(artist, `${item.id}_${artist}`),
					n.a({ class: 'eabWiki', href: `/artist/show?name=${artist}`, text: '?' }),
					n.a({href: `/post?tags=${artist}`, desc: [ n.span({ text: artist.replace(/_/g, ' '), title: artist }) ] })
				] }) );
			});

			if (postCont.childElementCount === 1) post.appendChild(n.span({ class: 'post-score eabGray', text: 'unknown' }));
		});
		
		postList = document.getElementById('post-list');
	}
	
	let retryCounter = 0, pLim, s;
	function watchlist() {
		let data = xhr.posts.response, p = 0;
		retryCounter--;
		
		data.forEach(item => {
			// p is the number of items in data processed (not skipped),
			// and s is the number of artists searched
			if (p === s) return;
			p++;
			
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
			
			// a post appeared which doesn't match the search - there must be an alias
			if ( i === -1 && pLim === 1 ) {
				httpRequest('GET', xhr.artist, '/artist/index.json', `?name=${artists[0]}`, alias);
				log.hide('action');  log.set('notice', 'Checking for alias...');
				xhr.artist.subject = artists.splice(0, 1)[0];
			} else if ( i > -1 && !blacklisted ) {
				insertItem( item, artists.splice(i, 1)[0] );
			} else p--;
		});
		
		// nothing found
		if (data.length === 0) {
			if (pLim === 1) {	// for an artist input
				log.set('action', `No artist called '${artists[0]}'`);
				artists.splice(0, 1);
				return;
			} else missing();
			
		// something found, but nothing processed - either blacklisted or a multi-part search with an alias
		// try again, 1 at a time, for all parts of input (using retryCounter)
		} else if (p === 0) {
			if (s > 1) retryCounter = pLim;
			else missing();
		}
		
		if (retryCounter > 0 && artists.length > 0) getPosts(1);
		else if (artists.length > 0) getPosts();
		else {
			prefs.time = Date.now()/1000;
			saveChanges();
		}
	}
	
	function missing() {
		let name = artists.splice(0, 1)[0];
		removeItem(name);
		
		let info = { i: [150, 100], t: [ 0, Math.floor(Date.now()/1000) ] };
		prefs.cache[name] = info;
		logItem( 0, name, info, 'missing' );
	}
	
	let formerTags, permit = { };
	function getPosts(lim = tagLim[window.location.host]) {
		if (artists.length === 0) return;
		let tags = '';
		
		// each tag is permitted 3 searches - if nothing found, it's probably just slowing things down, try searching it alone
		// same if no posts were recorded last time (alert)
		if ((permit[artists[0]] && permit[artists[0]] >= 3) || (prefs.cache[artists[0]] && prefs.cache[artists[0]].t[0] === 0)) {
			tags = artists[0];
			s = 1;
			
		} else for (s = 0; s < artists.length && s < lim; s++) {
			if (artists[s].charAt(0) === '-' || artists[s].length === 0) return artists.splice(s, 1);   // remove useless tags
			if (artists.length !== 1 && lim !== 1) tags += '~';
			tags += artists[s] + ' ';
			
			if (permit[artists[s]]) permit[artists[s]]++;
			else permit[artists[s]] = 1;
		}

		if (s !== 1) tags += `&limit=${s*6}`;   // slows search down w/ 1 tag
		if (tags === formerTags) quit(`Error: loop detected on search query '${tags}'`);
		formerTags = tags;
		
		pLim = lim;
		httpRequest('GET', xhr.posts, '/post/index.json', `?tags=${tags}`);
		log.set('action', 'Requesting posts...');
	}
	
	
	//}------------------//
	//-- Handling ------//{
	//-------------------//
	let times = [];
	function logItem(time, name, ...niArgs) {
		times.push(time);
		times.sort().reverse();
		
		let place = times.indexOf(time);
		sorted.splice(place, 0, name);
		
		let layer = 0;
		if (time === 0) layer = 'None';
		else layers.forEach(a => { if (a.time && (Date.now()/1000 - time) > a.time) layer++; });
		
		document.getElementById(`eabLayer${layer}`).style.display = 'block';
		
		if (time === 0) layer = layers.map(l => l.id).indexOf('None');
		gallery.insertBefore(  newItem(name, ...niArgs), gallery.childNodes[place + layer + 1] );
	}
	
	function newItem(artist, info, dText = '', alt = '') {
		let iSrc = ( info.i[2] && !noThumbs ) ? `${window.location.protocol}//static1.e621.net/data/preview/${info.i[2]}` : '';
		
		if (info.t[0] === 0) dText = 'missing';
		else if (info.t) {
			let date = new Date(info.t[0]*1000);
			dText = `${('0' + date.getDate()).slice(-2)} ${date.toLocaleString('en-us',{month:'short'})} <span class='eabFade'>${date.getFullYear()}</span>`;
		}
		
		/*console.log('artists', artists);
		console.log('sorted', sorted);
		console.log('times', times);*/
		
		return n.span({ id: 'ab-' + artist, class: `thumb ${info.class || ''}`, 'data-time': info.t[0], desc: [
			n.a({ style: `width: ${info.i[0]}px`, href: `/post?tags=${artist}`, desc: [
				n.img({ class: 'preview', alt, title: alt, src: iSrc, width: info.i[0], height: info.i[1] }),
				n.span({ class:'post-score', desc: [
					eabHeart(artist, `heart_${artist}`),
					n.a({ class: 'eabWiki', href: `/artist/show?name=${artist}`, text: '?' }),
					n.span({ text: artist.replace(/_/g, ' '), title: artist })
				] }),
				n.span({ class:'post-score post-date', html: dText })
			] })
		] });
	}
	
	function insertItem(item, name) {
		let time = item.created_at.s;
		
		let alt = `${item.tags} \n\nArtist: ${name} \nRating: ${{'s':'Safe','q':'Questionable','e':'Explicit'}[item.rating]} \nScore: ${item.score} \nFaves: ${item.fav_count}`;
		let info = {
			i: [ item.preview_width, item.preview_height, item.preview_url.split('/').splice(-3, 3).join('/') ],
			t: [ time, Math.floor(Date.now()/1000) ]
		};
		
		removeItem(name);
		prefs.cache[name] = info;
		logItem( time, name, info, '', alt );
	}
	
	function removeItem(name) {
		if (artists.includes(name)) artists.splice(artists.indexOf(name), 1);
		let prior = sorted.indexOf(name);
		if (prior > -1) {
			sorted.splice(prior, 1);
			times.splice(prior, 1);
		}
		
		let existing = document.getElementById(`ab-${name}`);
		if (existing) {
			if ( ![ existing.nextElementSibling.tagName, existing.previousElementSibling.tagName ].includes('SPAN') ) existing.previousElementSibling.style.display = 'none';
			existing.remove();
		}
	}
	
	
	//}------------------//
	//-- Management ----//{
	//-------------------//
	let purge = [];
	function heartToggle(e) {
		if (e) e.preventDefault();
		let artist = this.getAttribute('data-artist');
		
		if (artists.includes(artist)) artists.splice(artists.indexOf(artist), 1);
		else if (!sorted.includes(artist)) artists.splice(0, 0, artist);
		
		// if it's already been rendered and sorted, leave it alone for now, but don't save it later
		if (sorted.includes(artist)) purge.splice(0, 0, artist);
		
		directory[artist].forEach(id => { document.getElementById(id).className = heartClass(artist) + ' eabFade'; });
		
		saveChanges(function () {
			directory[artist].forEach(id => {
				document.getElementById(id).className = heartClass(artist);
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
		if (xhr.artist.response.length === 0) {
			log.reset();
			log.set('notice', `No artist called '${xhr.artist.subject}'`);
		} else {
			let artist = xhr.artist.response[0].name;

			log.hide('action');
			log.set('notice', `'${xhr.artist.subject}' is an alias,`);
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
	
	
	//}------------------//
	//-- Communication -//{
	//-------------------//
	let setDesc = () => 'This private set contains your configuration of the \nArtist Watchlist script. It is used so your list can be\npermanently stored between sessions. If this set\nis tampered with, the script may malfunction.\n\n' + LZString.compressToUTF16(JSON.stringify(prefs));
	
	['user', 'set', 'create', 'update', 'posts', 'add', 'artist'].forEach(page => { xhr[page] = new XMLHttpRequest(); });

	function httpRequest(method, page, url, data, callback) {
		if (callback) page.onload = callback;
		let form = (typeof data === 'string') ? null : new FormData();

		if (typeof data === 'string') url += data;
		else for (let part in data) form.append(part, data[part]);

		if (devMode) console.log(`Requesting ${window.location.origin + url}`);
		page.open(method, encodeURI(window.location.origin + url), true);
		page.responseType = 'json';
		page.send(form);
	}
	
	// check for more recent changes if preferences were recorded for this session more than x min ago
	function checkChanges(callback) {
		if ((Date.now()/1000 - storage('eabTime'))/60 > timeout['storage']) {
			let storedPrefs = storage('eabPrefs');
			getPrefs(function() {
				if (storedPrefs !== storage('eabPrefs')) eabRefresh();
				else callback();
			});
		} else callback();
	}

	function saveChanges(callback) {
		log.set('action', 'Saving watchlist...');
		
		// combine sorted and artists, remove duplicates and unfavorited
		prefs.watchlist = [...new Set([...sorted, ...artists])].filter(name => !purge.includes(name));
		
		checkChanges(function() {
			let compressed = setDesc();
			
			// limit: 10,000 chars UTF-16, one compressed cache entry is about 26 chars
			while (compressed.length > 10000) {
				let remove = Math.ceil((compressed.length - 10000)/24);
				
				for (let i = 0; i < remove; i++) delete prefs.cache[sorted[sorted.length - 1]];
				compressed = setDesc();
			}
			
			httpRequest('POST', xhr.update, '/set/update.json', {'set[description]':compressed,'set[id]':storage('eabSetId')}, function(e) {
				storage('eabPrefs', JSON.stringify(prefs));
				storage('eabTime', Date.now()/1000);

				if (callback) callback();
				if (storage('eabInvalidateCache')) localStorage.removeItem('eabInvalidateCache');
				log.set('action', 'Done!');
			});
		});
	}
	
	
	//}------------------//
	//-- Storage -------//{
	//-------------------//
	function storage(key, val) {
		if (!val) return localStorage.getItem(key);
		else localStorage.setItem(key, val);
		if (devMode) console.log(`Setting ${key} as ${val}`);
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
	
	// STEP 0 -- if login or version has changed, invalidate storage
	let cookie = { };
	document.cookie.split('; ').forEach(crumb => { cookie[crumb.split('=')[0]] = crumb.split('=')[1]; });
	if (storage('eabUserName') !== cookie.login || storage('eabVersion') !== currentVersion) clearStorage();
	storage('eabVersion', currentVersion);
	
	// STEPS 1-2 -- get user info, then prefs
	function getPrefs(callback) {
		httpRequest('GET', xhr.set, '/set/index.json', `?user_id=${storage('eabUserId')}&post_id=65067`, function() {
			if ((xhr.set.response.length) === 0) firstTime();
			else {
				storage('eabTime', Date.now()/1000);
				storage('eabSetId', xhr.set.response[0].id);
				
				let eabPrefs = xhr.set.response[0].description.split('\n')[5];
				if (eabPrefs.substr(0,2) !== '{"') eabPrefs = LZString.decompressFromUTF16(eabPrefs);
				else if (!storage('eabNoBug')) {
					alert('e621 Artist Watchlist has received a major update.\nYou will be prompted to save a backup of your watchlist\nso it can be restored if something goes wrong.');
					storage('eabNoBug', 'true');
					saveFile(xhr.set.response[0].description);
				}
				
				storage('eabPrefs', eabPrefs);
				callback();
			}
		});
	}
	
	if (storage('eabPrefs') && storage('eabUserId')) init();
	else httpRequest('GET', xhr.user, '/user/show.json', '', function() {
		storage('eabUserName', xhr.user.response.name);
		storage('eabUserId', xhr.user.response.id);

		getPrefs(init);
	});
	
	// STEP 3 -- first-time setup if necessary
	function firstTime() {
		log.set('action', 'First-time setup...');
		let name = 'artist_watchlist__' + Math.random().toString(36).substr(2, 10);

		prefs = { 'watchlist': [], 'blacklist': {}, 'cache': {} };
		httpRequest('POST', xhr.create, '/set/create.json', {'set[name]':name, 'set[shortname]':name, 'set[public]':'false', 'set[description]': setDesc()}, function() {
			storage('eabTime', Date.now()/1000);
			storage('eabSetId', xhr.create.response.set_id);
			storage('eabPrefs', JSON.stringify(prefs));

			httpRequest('POST', xhr.add, '/set/add_post.json', `?set_id=${storage('eabSetId')}&post_id=65067`, init());
			log.set('action', 'Ready! Add an artist below.');
		});
	}

})();
