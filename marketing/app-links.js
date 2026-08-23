/* Environment wiring for the marketing site.
 *
 * The page is authored once and deployed to two Static Web Apps. The only
 * difference between them is which app the CTAs point at, so rather than
 * building two variants we rewrite the links at runtime on the dev host.
 *
 * This is environment config, not a connectivity branch -- it does not belong
 * on the resilience register in .claude/rules/resilience.md, which governs
 * frontend/src. Deliberately dependency-free and inert on the production host.
 *
 * With JavaScript disabled the links stay pointed at production, which is the
 * right failure mode: a visitor still reaches a working app.
 */
(function () {
  'use strict';

  var PROD_APP = 'app.huddle.fitness';
  var DEV_APP = 'app.dev.huddle.fitness';

  // Only the lower environment is served from a "dev." host.
  if (window.location.hostname.indexOf('dev.') !== 0) return;

  var links = document.querySelectorAll('a[href*="' + PROD_APP + '"]');
  for (var i = 0; i < links.length; i++) {
    links[i].href = links[i].href.replace(PROD_APP, DEV_APP);
  }

  // Belt-and-braces alongside the environment robots.txt: the lower landing
  // page must never be indexed alongside the real one.
  var meta = document.createElement('meta');
  meta.name = 'robots';
  meta.content = 'noindex,nofollow';
  document.head.appendChild(meta);
})();
