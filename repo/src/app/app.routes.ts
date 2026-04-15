import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  // Auth flow
  {
    path: 'profiles',
    loadComponent: () =>
      import('./auth/pages/profiles-list.component').then(m => m.ProfilesListComponent),
  },
  {
    path: 'profiles/new',
    loadComponent: () =>
      import('./auth/pages/create-profile.component').then(m => m.CreateProfileComponent),
  },
  {
    path: 'sign-in/:profileId',
    loadComponent: () =>
      import('./auth/pages/sign-in.component').then(m => m.SignInComponent),
  },
  {
    path: 'persona',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./auth/pages/persona-select.component').then(m => m.PersonaSelectComponent),
  },

  // Workspace shell (Phase 3+)
  {
    path: 'workspaces',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./workspace/workspaces-list.component').then(m => m.WorkspacesListComponent),
  },
  {
    path: 'w/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./workspace/workspace-layout.component').then(m => m.WorkspaceLayoutComponent),
  },

  // Reporting (Phase 11)
  {
    path: 'reporting',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./reporting/report.page').then(m => m.ReportPage),
  },

  // Default redirect
  { path: '', redirectTo: 'profiles', pathMatch: 'full' },
  { path: '**', redirectTo: 'profiles' },
];
