import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PrefsService } from '../core/prefs.service';
import type { PersonaRole } from '../core/types';

export type Capability =
  | 'manage-profiles'
  | 'delete-workspace'
  | 'export-package'
  | 'import-package'
  | 'view-reporting'
  | 'moderate-board';

const ROLE_CAPS: Record<PersonaRole, Capability[]> = {
  'Admin': [
    'manage-profiles',
    'delete-workspace',
    'export-package',
    'import-package',
    'view-reporting',
    'moderate-board',
  ],
  'Academic Affairs': [
    'export-package',
    'import-package',
    'view-reporting',
    'moderate-board',
  ],
  'Teacher': ['export-package'],
};

/**
 * Persona role capability map.
 *
 * ⚠️ This is a UI-only convenience layer — NOT a security boundary.
 * All data is stored locally; any user can clear browser storage to reset.
 */
@Injectable({ providedIn: 'root' })
export class PersonaService {
  constructor(private readonly prefs: PrefsService) {}

  get role(): PersonaRole | undefined {
    return this.prefs.get('personaRole');
  }

  get role$(): Observable<PersonaRole | undefined> {
    return this.prefs.select$('personaRole');
  }

  setRole(role: PersonaRole): void {
    this.prefs.set('personaRole', role);
  }

  hasCap(cap: Capability): boolean {
    const role = this.role;
    if (!role) return false;
    return ROLE_CAPS[role].includes(cap);
  }
}
