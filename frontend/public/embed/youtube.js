// Builds the YouTube player for /embed/youtube.html from ?v=<video id>. See that file's header for
// why this page exists. Plain script, not part of the bundle.
//
// Only an 11-character YouTube id is accepted, so this page can only ever frame a YouTube video:
// never a URL, never markup. Anything else shows a short message instead of a player.
//
// ?host=youtube switches from youtube-nocookie.com (the default: no cookies until play) to
// youtube.com, so the two can be compared on a device.
(function () {
  var params = new URLSearchParams(window.location.search);
  var id = params.get('v') || '';
  var body = document.body;

  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    var p = document.createElement('p');
    p.textContent = 'This video link is not valid.';
    body.appendChild(p);
    return;
  }

  var base = params.get('host') === 'youtube' ? 'https://www.youtube.com/embed/' : 'https://www.youtube-nocookie.com/embed/';
  var frame = document.createElement('iframe');
  // playsinline: iPhone otherwise forces fullscreen on play. rel=0: suggestions from the same
  // channel only.
  frame.src = base + id + '?playsinline=1&rel=0';
  frame.title = 'Exercise demo video';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allowFullscreen = true;
  body.appendChild(frame);
})();
