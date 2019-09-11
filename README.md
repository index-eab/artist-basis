**Artist Basis** is a collection of tools to help you discover new artists and keep an eye on your favorites. The following features are added:
  
  
#### Artist Watchlist
![Artist Watchlist](https://raw.githubusercontent.com/index-eab/artist-basis/master/img/demo/watchlist2.jpg)
This page offers specialized tag subscriptions for artists. It helps you keep up with the activity of your favorite artists on e621, and also provides convenient access to more primary sources. In most places where artist tags exist on the site, you'll find a small ♥ icon to add that artist to the watchlist.

#### Artist Gallery
![Artist Gallery](https://raw.githubusercontent.com/index-eab/artist-basis/master/img/demo/gallery.jpg)
An overwhelming number of posts exist on e621, so it can be difficult to find artists you're interested in. The Artist Gallery lets you browse artist tags on the site in a gallery format, giving an artist with 2000 posts and one with 10 posts an equal platform. An artist's post with the highest favorite count is the one shown.

There's a gallery for each artist database on the site - tags and wikis. The tag database is faster and more complete, but they each have their uses. More info can be found in the tool's help page.

#### Artist Search
![Artist Search](https://raw.githubusercontent.com/index-eab/artist-basis/master/img/demo/search.jpg)
This page searches both artist databases for a given creator and presents the results in a way that makes sense (and in a gallery format, of course). It can make searching for an artist by name or alias much easier.

#### View artists
![View artists](https://raw.githubusercontent.com/index-eab/artist-basis/master/img/demo/view_artists.jpg)
This simple addition to the mode menu shows you the artists associated with each post. Expansion to this feature is planned for a later release.
  
  
## Installation
1. Have a userscript manager (eg Tampermonkey - ![Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) **·** ![Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en) **·** ![Other](https://www.tampermonkey.net/)
2. Install the script from here: https://github.com/index-eab/artist-basis/raw/master/artist_basis.user.js
3. If you already have an old version of Artist Watchlist (version 1.x) installed, please remove it.
  
<details><summary>Version history</summary>

Released as **Artist Gallery** and quickly withdrawn.

<details><summary>Version 0.0 (2016-06-01)</summary>
* Basic gallery functions.
</details>

Total rewrite, released as **Artist Watchlist**.

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
* Before, the watchlist showed only the latest post and you had to manually check for more. Now all new posts are accounted for - the watchlist will report, for example, that an artist has 6 new posts since your last visit, and you can expand them without leaving the page.
* Changed thumbnail links to make more sense with the above change. Check the new help page for an overview.
* The watchlist now enters a "cooldown" state after it updates. Until the cache expires (90 minutes), you can navigate away and back without the state of the watchlist changing.
* "View artists" mode is now maintained between pages, like the native modes.
* Stylistic changes, and greatly improved theme system.
* Further optimized database, saving about 25% storage space.
* Flash thumbnails are now shown properly.
</details>

Third release as **Artist Basis** - the first real release of the tool as I originally envisioned it. Much of the script was rewritten.

<details><summary>Version 2.0 (2019-08-24)</summary>
* The script now has its own top-level tab. Look for **Basis** to the right of **Artists* in the site navigation.
* Added a comprehensive Help and Configuration pages. Blacklist setup and cache management were moved here, along with countless other topics.
* I eliminated the "Add/remove artist" field and replaced it with a search that leads to the tag galley. It was an awful, inflexible input method now that other options are available.
* "Other sites" section added to the watchlist - intended to make the watchlist a hub for your watchlists on other sites where artists upload their work.
* Faster, more reliable, and more transparent handling of irregular tags (aliases, no posts, etc).
* Storage is better regulated: every preference is individually limited so that onsite storage is never exceeded.
* The tool now drops into a "simple search" mode in case the server is taking too long to process requests.
* Countless minor enhancements and stability fixes.
* Thumbnail caption now flexes to accommodate long artist names.
</details>

</details>
