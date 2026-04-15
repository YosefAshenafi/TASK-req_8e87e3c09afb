import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { PersonaService } from '../persona.service';
import { AuthService } from '../auth.service';
import type { PersonaRole } from '../../core/types';

const ROLE_DESCRIPTIONS: Record<PersonaRole, string> = {
  'Admin': 'Full access — manage profiles, import/export packages, and view reports.',
  'Academic Affairs': 'Moderate the board, export packages, and view reports.',
  'Teacher': 'Create and collaborate on workspaces; export packages.',
};

/**
 * Persona select page.
 * ⚠ Role selection is a UI-only convenience — not a security boundary.
 */
@Component({
  selector: 'app-persona-select',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="persona-page">
      <h2>Choose your role</h2>
      <p class="subtitle">
        Welcome, <strong>{{ auth.currentProfile?.username }}</strong>.
        Select the role that matches your context for this session.
      </p>

      <ul class="role-list" role="list">
        @for (role of roles; track role) {
          <li>
            <button class="role-card" (click)="selectRole(role)">
              <span class="role-name">{{ role }}</span>
              <span class="role-desc">{{ description(role) }}</span>
            </button>
          </li>
        }
      </ul>

      <p class="local-notice">
        ⚠ Role selection is a local-machine convenience for menu visibility only — it is not a
        security boundary.
      </p>
    </div>
  `,
  styleUrl: './persona-select.component.scss',
})
export class PersonaSelectComponent {
  protected readonly roles: PersonaRole[] = ['Admin', 'Academic Affairs', 'Teacher'];

  constructor(
    protected readonly auth: AuthService,
    private readonly persona: PersonaService,
    private readonly router: Router,
  ) {}

  protected description(role: PersonaRole): string {
    return ROLE_DESCRIPTIONS[role];
  }

  protected selectRole(role: PersonaRole): void {
    this.persona.setRole(role);
    this.router.navigate(['/workspaces']);
  }
}
