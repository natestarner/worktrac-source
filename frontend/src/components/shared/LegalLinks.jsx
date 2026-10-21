// Terms and Privacy live only on the marketing site (huddle.fitness) -- there is no in-app copy,
// and deliberately so: unlike the Handbook (user-facing-help.md), these are read rarely and are
// never needed to operate the app mid-workout, so a plain external link is the right trade-off
// here rather than mirroring the text in-app just to survive being read in the basement.
//
// Centralized here (URL + rendering) rather than three copy-pasted <a> pairs, so registration,
// billing and settings can't drift in wording or link target, and the URL only ever needs to
// change in one place.
//
// externalLinkProps is the same new-tab anchor on the web; in the iOS app it opens the in-app
// browser sheet instead, since a `_blank` link there would leave the app for Safari.
import { externalLinkProps } from '../../lib/native';

export const TERMS_URL = 'https://huddle.fitness/terms.html';
export const PRIVACY_URL = 'https://huddle.fitness/privacy.html';

export default function LegalLinks({ separator = ' and ' }) {
  return (
    <>
      <a {...externalLinkProps(TERMS_URL)} className="legal-link">
        Terms
      </a>
      {separator}
      <a {...externalLinkProps(PRIVACY_URL)} className="legal-link">
        Privacy Policy
      </a>
    </>
  );
}
