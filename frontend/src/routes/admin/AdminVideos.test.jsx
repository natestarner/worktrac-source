import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminVideos from './AdminVideos';
import { getLibraryVideos } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  getLibraryVideos: vi.fn(),
}));

describe('AdminVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says how much of the library has a video, and lists what does not', async () => {
    getLibraryVideos.mockResolvedValue({
      libraryCount: 213,
      withVideoCount: 79,
      missing: [
        { exerciseId: 1, name: 'Hammer Curl', reason: 'none', videoId: null, checkedAt: null, peopleUsing: 4 },
        {
          exerciseId: 2,
          name: 'Barbell Bench Press',
          reason: 'unavailable',
          videoId: 'tuwHzzPdaGc',
          checkedAt: '2026-11-06T04:30:00Z',
          peopleUsing: 9,
        },
      ],
    });
    render(<AdminVideos />);

    expect(await screen.findByText(/79 of 213 library exercises have a how-to video/)).toBeInTheDocument();
    expect(screen.getByText('Hammer Curl')).toBeInTheDocument();
    expect(screen.getByText('No video yet')).toBeInTheDocument();
    // A hidden video names its dead id and links to it, so it can be checked and replaced.
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'tuwHzzPdaGc' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=tuwHzzPdaGc',
    );
  });

  it('says so when every library exercise has a video', async () => {
    getLibraryVideos.mockResolvedValue({ libraryCount: 3, withVideoCount: 3, missing: [] });
    render(<AdminVideos />);
    expect(await screen.findByText('Every library exercise has a video.')).toBeInTheDocument();
  });
});
