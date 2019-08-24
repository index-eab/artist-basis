// ==UserScript==
// @name        e621 Artist Gallery
// @namespace   e621ag
// @include     *//e621.net/artist*
// @exclude     *//e621.net/artist/*
// @version     1.0
// ==/UserScript==

window.addEventListener('load', function() {
	var sort = 'favcount';   // recommended: 'favcount' or 'score' -- https://e621.net/help/show/cheatsheet#sorting
	
	var content = document.getElementById('content'),
	    artistRows = content.getElementsByTagName('tbody')[1].getElementsByTagName('tr'),
	    artists = [], artistLinks = [];

	for (var i = 0; i < artistRows.length; i++) {
		artists.push(artistRows[i].children[1].firstElementChild.innerHTML);
		artistLinks.push(artistRows[i].children[1].firstElementChild.href);
	}

	content.innerHTML = '<div id="post-list"><div class="sidebar"><div style="margin:0 0 1em"><h5>Search</h5>' + document.getElementById('searchform').lastElementChild.outerHTML.replace(/\d\d\dpx/g, '140px') + '</div><div style="margin:0 0 1em"><h5>Progress</h5><span id="eag-counter">0</span>/' + artists.length + '</div><div id="eag-noWorks" style="margin:0 0 1em;display:none"><h5>No Works</h5></div></div><div class="content-post"><div id="eag-gallery"></div>' + document.getElementById('paginator').outerHTML + '</div></div><div class="Clear">&nbsp;</div>';

	i = -1;
	var xhr = new XMLHttpRequest(), anim = false,
	    ratings = { 's' : 'Safe', 'q' : 'Questionable', 'e' : 'Explicit' },
	    noWorks = document.getElementById('eag-noWorks'),
	    gallery = document.getElementById('eag-gallery'),
	    counter = document.getElementById('eag-counter');

	xhr.onload = function() {
		var result = xhr.responseText;
		
		if (result.length < 5 && !anim) return addNoWorks();   // empty response: no art
		else if (result.length > 5) {
			var data = JSON.parse(result.substring(1, result.length - 1)),   // responseType = 'json' doesn't work in IE
			    newItem = anim ? gallery.lastElementChild : document.createElement('span');
			
			newItem.className = 'thumb';
			newItem.innerHTML = '<a class="tooltip-thumb" href="/post?tags=' + artists[i] + '+order:' + sort + '"><img class="preview" src="' + data.preview_url + '" width="' + data.preview_width + 'px" height="' + data.preview_height + 'px" ' + (anim ? 'style="border:3px solid #F00"' : '') + ' title="' + data.tags + ' &#10;&#10;Artist: ' + artists[i] +  ' &#10;Rating: ' + ratings[data.rating] + ' &#10;Score: ' + data.score + ' &#10;Faves: ' + data.fav_count + '"></a><a href="' + artistLinks[i] + '"><span class="post-score" style="display:inline-block;padding:0 4px;min-width:' + (data.preview_width - 8) + 'px">' + artists[i] + '</span></a>';
			
			if (!anim) gallery.appendChild(newItem);
			if (data.file_ext === 'swf' || data.file_ext === 'webm') {   // no thumbnail - try again
				i--;
				anim = true;
			} else anim = false;
		} else anim = false;
		
		if ((i+1) < artists.length) getItem();
	};

	function getItem() {
		i++;
		counter.innerHTML = i + 1;
		
		if (artists[i].charAt(0) === '-' || artists[i].length === 0) addNoWorks();   // don't query useless tags, takes too long
		else {
			xhr.open('GET', "https://e621.net/post/index.json?limit=1&tags=" + artists[i] + "+order:" + sort + (anim ? '+-flash+-animated' : ''), true);
			xhr.send();
		}
	}
	
	function addNoWorks() {
		var newArtist = document.createElement('div');
		newArtist.innerHTML = '<a href="' + artistLinks[i] + '">' + artists[i] + '</a>';
		
		noWorks.style.display = '';
		noWorks.appendChild(newArtist);
		if ((i+1) < artists.length) getItem();
	}
	
	getItem();
});
