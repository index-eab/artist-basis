**Artist Basis** is a collection of tools that helps you discover new artists and watch for new posts from your favorite creators. Short descriptions and demonstrations are below.
  
  
## Features
#### "Artist Watchlist":https://raw.githubusercontent.com/index-eab/artist-basis/master/img/demo/watchlist.jpg
This page offers specialized tag subscriptions for artists. It helps you keep up with the activity of your favorite artists on e621, and also provides convenient access to primary sources for uploaders. In most places where you find artist tags on the site, you'll find a small ♥ icon to add that artist to the watchlist.

#### "Artist Gallery":https://raw.githubusercontent.com/index-eab/artist-basis/master/img/demo/gallery.jpg
An overwhelming number of posts exist on e621, so it can be difficult to find artists you're interested in. The Artist Gallery lets you browse artist tags on the site in a gallery format. I've been using it personally for years, and it's found me countless hidden gems that I'd never been made aware of otherwise.

There's a gallery for each artist database on the site - tags and wikis. The tag database is faster and more complete, but they each have their uses. More info can be found in the tool's help page.

#### "Artist Search":https://raw.githubusercontent.com/index-eab/artist-basis/master/img/demo/search.jpg
This page searches both artist databases and presents the results in a way that makes sense (and in a gallery format, of course). It can make searching for an artist by name much easier.

#### Other
* A "View artists" mode is also added to the mode menu.
* Blacklisting is supported.  
h6.  
  
  
## Installation
1. Have a userscript manager (eg Tampermonkey - "Firefox":https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/ [b]·[/b] "Chrome":https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en [b]·[/b] "Other":https://www.tampermonkey.net/)
2. Install here: https://openuserjs.org/install/index-eaw/Artist_Watchlist.user.js
  
<details><summary>Version history</summary>

Released as [b]Artist Gallery[/b] and quickly withdrawn.

<details><summary>Version 0.0 (2016-06-01)</summary>
* Basic gallery functions.
</details>

Total rewrite, released as [b]Artist Watchlist[/b].

<details><summary>Version 1.0 (2018-08-18)</summary>
* Dropped the gallery. Basic watchlist functions only.
</details>

<details><summary>Version 1.1 (2018-10-26)  (skipped release)</summary>
* You can now favorite artists from the sidebar of posts and search results.
* Thumbnails on the watchlist are now cached, reducing server strain and wait times. Expired thumbnails are grayed out.
</details>

<details><summary>Version 1.2 (2018-11-08)</summary>
* There's a new mode in search results and on favorite post lists, "View artists", for more convenient artist favoriting.
* New, easier to read date format
* Support for very large watchlists
* Fixed errors that could occur if you used the script in two places simultaneously
* eSix Extend compatibility
* Numerous bug fixes and stability improvements
</details>

<details><summary>Version 1.3 (2019-04-10)</summary>
* You can now blacklist tags.
* The watchlist is now divided into time categories, including one highlighting posts since your last visit.
* On the watchlist and in the artist view mode, hover over posts to show the favorites <3. Links to artist wikis were also added.
* Compression! The max size of the watchlist has increased by about 4x.
* The style now adjusts to themes besides Hexagon.
* Greatly improved stability and performance in certain edge cases.
* Added options to create backups and clear cached results.
</details>

<details><summary>Version 1.4 (2019-06-29)  (skipped release)</summary>
* Changed thumbnail links to make more sense with the above change: Click a thumbnail to be taken to that particular post. Click an artist's name or the date to go that artist's post list. As always, hover over the thumbnail and click the ? to go that artist's wiki.
* The watchlist will now fully maintain its state if you navigate away, until the cache expires (60 minutes)
* "View artists" mode is now maintained between pages, like the native modes. Accordingly the mode can now be exited from the sidebar.
* Stylistic changes, and improved theme integration (bloodlust in particular looks much better :3)
* Further optimized database, making about 20% more space in the watchlist
* Flash thumbnails are now shown properly
</details>

Third release as [b]Artist Basis[/b] - the first real release of the tool as I originally envisioned it. Much of the script was rewritten.

<details><summary>Version 2.0 (2019-08-12)</summary>
* Re-introduced artist galleries, drastically improved from the initial release.
* Added a comprehensive help page. Moved configuration options to a config page.
* Added a section to the watchlist
* Stability improvements
</details>

</details>
