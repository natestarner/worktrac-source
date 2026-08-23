// Loads and plays a muted, looping product-demo clip only once it scrolls near the
// viewport, so it never competes with the page's initial load. <video preload="none">
// alone isn't a hard guarantee across browsers, so the <source> starts with no `src`
// (real URL parked in data-src) until this script wires it up.
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
        var source = video.querySelector('source[data-src]');
        if (!source) return;
        source.src = source.getAttribute('data-src');
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
