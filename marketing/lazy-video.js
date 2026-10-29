// Loads and plays a muted, looping product-demo clip only once it scrolls near the
// viewport, so it never competes with the page's initial load. <video preload="none">
// alone isn't a hard guarantee across browsers, so each <source> starts with no `src`
// (real URL parked in data-src) until this script wires it up.
//
// Every source is wired, not just the first: the clip ships as H.264 MP4 (Safari, every
// iPhone) and VP9 WebM (browsers without H.264), and the browser picks between them by
// each <source>'s `type` -- which it can only do if both have a `src`.
//
// Visitors who prefer reduced motion never get the video at all -- the <video>'s
// `poster` frame stays as a plain still image, and no bytes are fetched.
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var videos = document.querySelectorAll('video.js-lazy-video');
  if (!videos.length || !('IntersectionObserver' in window)) return;

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        var video = entry.target;
        var sources = video.querySelectorAll('source[data-src]');
        if (!sources.length) return;
        sources.forEach(function (source) {
          source.src = source.getAttribute('data-src');
        });
        video.load();
        video.play().catch(function () {
          /* Autoplay can still be blocked by the browser; the poster frame stands in. */
        });
      });
    },
    { rootMargin: '200px 0px' }
  );

  videos.forEach(function (video) {
    observer.observe(video);
  });
})();
