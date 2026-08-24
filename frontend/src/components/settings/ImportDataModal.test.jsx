import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportDataModal from './ImportDataModal';
import { commitImport, previewImport } from '../../api/dataImport';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/dataImport', () => ({ previewImport: vi.fn(), commitImport: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast: vi.fn(), openConfirm: vi.fn() }) }));

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImportDataModal onClose={onClose} />
    </QueryClientProvider>,
  );
}

// jsdom's file input needs a real File; .text() is what the component calls for a CSV.
function chooseFile(name = 'workouts.csv', content = 'Exercise,Date,Reps\nBench,2026-08-20,8\n') {
  const file = new File([content], name, { type: 'text/csv' });
  const input = screen.getByLabelText('Choose a file');
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

function preview(overrides = {}) {
  return {
    batchId: null,
    sessionCount: 1,
    setCount: 3,
    skippedDuplicateCount: 0,
    newExerciseNames: [],
    notesApplied: 0,
    notesSkipped: 0,
    favoritesApplied: 0,
    tagsApplied: 0,
    newTagNames: [],
    sessionNotesApplied: 0,
    appliedDefaults: [],
    ignoredColumns: [],
    rowErrors: [],
    ...overrides,
  };
}

describe('ImportDataModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAuth.mockReturnValue({
      people: [
        { id: 1, name: 'Nate' },
        { id: 2, name: 'Ethan' },
      ],
    });
    useAppState.mockReturnValue({ activePersonId: 1, selectPerson: vi.fn() });
  });
  afterEach(() => onlineManager.setOnline(true));

  // The contract has to be readable BEFORE a file is picked -- discovering it from an error is
  // the failure this disclosure exists to prevent.
  it('states which columns are required before any file is chosen', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /What the file needs/ }));

    expect(screen.getByText('Exercise')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Reps')).toBeInTheDocument();
    expect(screen.getByText(/Custom Fields and Est. 1RM aren’t/)).toBeInTheDocument();
  });

  it('previews the chosen file against the selected person', async () => {
    previewImport.mockResolvedValue(preview());
    renderModal();

    chooseFile();

    await waitFor(() => expect(previewImport).toHaveBeenCalledWith(1, expect.any(String), 'workouts.csv'));
    expect(await screen.findByText(/will be added to Nate’s history/)).toBeInTheDocument();
  });

  // Which rows count as duplicates depends entirely on whose history they're compared against, so
  // changing the person has to re-ask rather than reuse the previous answer.
  it('re-previews against the new person when the target changes', async () => {
    previewImport.mockResolvedValue(preview());
    renderModal();
    chooseFile();
    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Import into'), { target: { value: '2' } });

    await waitFor(() => expect(previewImport).toHaveBeenLastCalledWith(2, expect.any(String), 'workouts.csv'));
  });

  // The count on the button is what will actually happen -- someone must not press "Import 42" and
  // get 40.
  it('puts the real count and the target person on the button', async () => {
    previewImport.mockResolvedValue(preview({ setCount: 42 }));
    renderModal();
    chooseFile();

    expect(await screen.findByRole('button', { name: 'Import 42 sets into Nate' })).toBeEnabled();
  });

  it('counts only the importable rows when some cannot be read', async () => {
    previewImport.mockResolvedValue(
      preview({ setCount: 40, rowErrors: [{ line: 3, message: 'No date.' }, { line: 9, message: 'No date.' }] }),
    );
    renderModal();
    chooseFile();

    expect(await screen.findByRole('button', { name: 'Import 40 of 42 rows' })).toBeInTheDocument();
    expect(screen.getByText('Line 3:', { exact: false })).toBeInTheDocument();
  });

  // Offering a button that would do nothing is worse than not offering one.
  it('disables importing when every row is already there, and says so', async () => {
    previewImport.mockResolvedValue(preview({ setCount: 0, sessionCount: 0, skippedDuplicateCount: 42 }));
    renderModal();
    chooseFile();

    expect(await screen.findByText(/Nothing to import/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('reports the defaults it applied before anything is committed', async () => {
    previewImport.mockResolvedValue(
      preview({ appliedDefaults: ['No Weight column -- every set is imported as bodyweight (0).'] }),
    );
    renderModal();
    chooseFile();

    expect(await screen.findByText(/imported as bodyweight/)).toBeInTheDocument();
  });

  it('says when exercises and tags will reach the whole household', async () => {
    previewImport.mockResolvedValue(preview({ newExerciseNames: ['Neck Curl'], newTagNames: ['Neck'] }));
    renderModal();
    chooseFile();

    expect(await screen.findByText(/added to your household's shared lists/)).toBeInTheDocument();
  });

  it('shows the result and offers an undo route once committed', async () => {
    previewImport.mockResolvedValue(preview());
    commitImport.mockResolvedValue(preview({ batchId: 7 }));
    renderModal();
    chooseFile();

    fireEvent.click(await screen.findByRole('button', { name: /^Import 3 sets/ }));

    expect(await screen.findByText('Import complete')).toBeInTheDocument();
    expect(screen.getByText(/Undo this import from the Data section/)).toBeInTheDocument();
  });

  // A gated write has no outbox behind it, so a failure must not also cost the person their file
  // selection -- the modal stays put and the whole thing is one more tap.
  it('keeps the file and preview when the commit fails', async () => {
    previewImport.mockResolvedValue(preview());
    commitImport.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    renderModal(onClose);
    chooseFile();

    fireEvent.click(await screen.findByRole('button', { name: /^Import 3 sets/ }));

    await waitFor(() => expect(commitImport).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /^Import 3 sets/ })).toBeInTheDocument();
    expect(screen.getByText(/will be added to Nate’s history/)).toBeInTheDocument();
  });

  it('refuses to import while offline and says why', async () => {
    onlineManager.setOnline(false);
    renderModal();

    expect(screen.getByText('Importing needs a connection.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});
