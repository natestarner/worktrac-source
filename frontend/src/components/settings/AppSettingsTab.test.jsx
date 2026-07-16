import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppSettingsTab from './AppSettingsTab';
import { createPersonCategory, listCategoryRecommendations } from '../../api/personCategories';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { usePersonCategories } from '../../hooks/usePersonCategories';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/personCategories', () => ({
  createPersonCategory: vi.fn(),
  deletePersonCategory: vi.fn(),
  listCategoryRecommendations: vi.fn(),
}));
vi.mock('../../api/exercises', () => ({ removeExercise: vi.fn(), favoriteExercise: vi.fn(), unfavoriteExercise: vi.fn() }));
vi.mock('../../api/account', () => ({ updateDefaultUnit: vi.fn() }));
vi.mock('../../api/export', () => ({ downloadAllPeopleZip: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../hooks/usePersonExercises', () => ({ usePersonExercises: vi.fn() }));
vi.mock('../../hooks/usePersonCategories', () => ({ usePersonCategories: vi.fn() }));

describe('AppSettingsTab category management', () => {
  let refetchPersonCategories;

  beforeEach(() => {
    vi.clearAllMocks();
    createPersonCategory.mockResolvedValue({ id: 1 });
    listCategoryRecommendations.mockResolvedValue([]);
    refetchPersonCategories = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [{ id: 5, name: 'Sam' }], refreshPeople: vi.fn() });
    useAppState.mockReturnValue({ activePersonId: 5 });
    useUI.mockReturnValue({ openConfirm: vi.fn() });
    useExercises.mockReturnValue({ exercises: [], loading: false, refetch: vi.fn() });
    usePersonExercises.mockReturnValue({ exercises: [], loading: false, refetch: vi.fn().mockResolvedValue() });
    usePersonCategories.mockReturnValue({ categories: [], loading: false, refetch: refetchPersonCategories });
  });

  it('shows an error and does not add a category when the name is blank', async () => {
    render(<AppSettingsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a category name.')).toBeInTheDocument();
    expect(createPersonCategory).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('New category name'), { target: { value: 'Legs' } });
    expect(screen.queryByText('Enter a category name.')).not.toBeInTheDocument();
  });

  it('creates a per-person category once a name is provided', async () => {
    render(<AppSettingsTab />);

    fireEvent.change(screen.getByPlaceholderText('New category name'), { target: { value: 'Legs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createPersonCategory).toHaveBeenCalledWith(5, 'Legs'));
    expect(refetchPersonCategories).toHaveBeenCalled();
  });
});
