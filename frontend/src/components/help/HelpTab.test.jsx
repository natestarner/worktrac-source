import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HelpTab from './HelpTab';
import { EXERCISE_METRICS } from '../trends/exerciseMetrics';
import { WEEKLY_METRICS } from '../trends/weeklyMetrics';
import { DEFAULT_REST_TARGET_SECONDS, REST_CEILING_SECONDS } from '../../utils/restTarget';
import { useUI } from '../../context/UIContext';

// "Take the tour" is the only thing on this page that reaches into UIContext -- mocked rather
// than wrapped in the real provider, matching the convention every other component test here
// uses (see AddPersonModal.test.jsx).
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
// The install section reads the App Store listing from /me's client config (HelpTab.native.test.jsx
// covers both answers); nothing else on the page reaches into AuthContext.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ client: null }) }));

function renderHelp() {
  return render(
    <MemoryRouter>
      <HelpTab />
    </MemoryRouter>,
  );
}

// Every anchor something else in the app may deep-link to (/app/help#<id>). Renaming one of these
// silently breaks that link, so the list is pinned here rather than derived from the component --
// deriving it would make the test agree with any rename, which is the opposite of the point.
const SECTION_IDS = [
  'setup',
  'people',
  'logging',
  'rest',
  'time',
  'own',
  'routines',
  'history',
  'prs',
  'trends',
  'personal',
  'settings',
  'logins',
  'visibility',
    'coaching',
  'plan',
  'data',
  'offline',
  'trouble',
];

describe('HelpTab', () => {
  beforeEach(() => {
    useUI.mockReturnValue({ startTour: vi.fn() });
  });

  // JSX drops a line break between text and a tag on the next line, so "or\n<T>Cancel</T>" renders
  // "orCancel". The handbook shipped three of those ("orCancel", "useForgot password",
  // "neverClients"). Scans the page as a reader sees it: a lowercase letter running straight into
  // a capital is a missing space, unless it is one of the real words below.
  it('has no words run together where a line break swallowed the space', () => {
    const { container } = renderHelp();
    // Only INLINE neighbours can glue: a heading beside a paragraph is laid out on its own line.
    const INLINE = new Set(['SPAN', 'STRONG', 'EM', 'B', 'I', 'A', 'CODE', 'KBD', 'SMALL', 'MARK']);
    const glued = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (!INLINE.has(el.tagName)) continue;
      const before = el.previousSibling;
      const after = el.nextSibling;
      const text = el.textContent;
      if (before?.nodeType === Node.TEXT_NODE && /[A-Za-z]$/.test(before.textContent) && /^[A-Za-z]/.test(text)) {
        glued.push(`${before.textContent.slice(-12)}|${text.slice(0, 12)}`);
      }
      if (after?.nodeType === Node.TEXT_NODE && /[A-Za-z]$/.test(text) && /^[A-Za-z]/.test(after.textContent)) {
        glued.push(`${text.slice(-12)}|${after.textContent.slice(0, 12)}`);
      }
    }
    expect(glued).toEqual([]);
  });

  it('offers "Take the tour", which replays the onboarding tour', () => {
    const startTour = vi.fn();
    useUI.mockReturnValue({ startTour });
    renderHelp();

    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }));

    expect(startTour).toHaveBeenCalledTimes(1);
  });

  it('renders every section at its published anchor', () => {
    const { container } = renderHelp();
    for (const id of SECTION_IDS) {
      expect(container.querySelector(`#${id}`), `missing section #${id}`).toBeTruthy();
    }
  });

  it('lists every section in the contents, so nothing is reachable only by scrolling', () => {
    const { container } = renderHelp();
    for (const id of SECTION_IDS) {
      expect(container.querySelector(`a[href="#${id}"]`), `#${id} missing from contents`).toBeTruthy();
    }
  });

  // The anti-drift guarantee. The handbook must READ the metric tables rather than restate them,
  // so the in-app "?" (ChartHelp) and this page cannot disagree about what a mark means. Pasting
  // the prose in would pass a hand-written assertion on one sentence; asserting across the whole
  // table is what actually fails when someone adds a sixth metric and forgets this page.
  it('describes every exercise metric using the same copy ChartHelp renders', () => {
    renderHelp();
    for (const metric of Object.values(EXERCISE_METRICS)) {
      expect(screen.getByText(metric.dotMeaning), `no copy for ${metric.label}`).toBeInTheDocument();
    }
  });

  it('describes every weekly metric using the same copy ChartHelp renders', () => {
    renderHelp();
    for (const metric of Object.values(WEEKLY_METRICS)) {
      expect(screen.getByText(metric.barMeaning), `no copy for ${metric.label}`).toBeInTheDocument();
    }
  });

  // Same idea for the two rest-timer numbers: they are stated as fact to the user, and they live
  // in restTarget.js. Reading them means changing the constant updates the sentence.
  it('quotes the rest-timer target and ceiling from restTarget.js, not from memory', () => {
    renderHelp();
    expect(screen.getByText(new RegExp(`${DEFAULT_REST_TARGET_SECONDS}-second target`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${REST_CEILING_SECONDS / 60} minutes`))).toBeInTheDocument();
  });

  it('ends every section with a way back to the contents', () => {
    const { container } = renderHelp();
    // The installed PWA has no browser Find, and a floating back-to-top pill is ruled out by the
    // one-fixed-bottom-box rule -- so this link is the only way back from the foot of a section.
    const backLinks = container.querySelectorAll('a[href="#contents"]');
    expect(backLinks).toHaveLength(SECTION_IDS.length);
    expect(container.querySelector('#contents')).toBeTruthy();
  });

  it('falls open when matchMedia is unavailable, so the list can never be stranded closed', () => {
    // jsdom implements no matchMedia, which is exactly the environment the guard in Contents()
    // exists for. Degrading to "closed" here would hide the list behind a summary that is
    // display:none at >=880px -- unreachable. Remove the typeof guard and this throws.
    expect(window.matchMedia).toBeUndefined();
    const { container } = renderHelp();
    expect(container.querySelector('#contents').open).toBe(true);
  });

  it('states the Epley formula, which no constant can supply', () => {
    renderHelp();
    // Deliberately asserted as a literal: the formula is prose the codebase cannot hand us, so it
    // is exactly the kind of claim `.claude/rules/user-facing-help.md` exists to keep honest.
    expect(screen.getByText(/estimated 1RM = weight/)).toBeInTheDocument();
  });

  // The body diagrams' MIT licence asks for its notice in every copy of the app. It used to sit in
  // the muscle sheet; this page is now the one place that carries it, so deleting it here would
  // leave the app shipping the art without its licence.
  it('carries the body art licence notice', () => {
    renderHelp();
    expect(screen.getByText('Open-source credits')).toBeInTheDocument();
    expect(screen.getByText(/js-rich-body-highlighter 0\.1\.1\. MIT License\./)).toBeInTheDocument();
    expect(screen.getByText(/Permission is hereby granted, free of charge/)).toBeInTheDocument();
  });
});
