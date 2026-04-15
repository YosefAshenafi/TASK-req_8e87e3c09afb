import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth.service';
import { AppException } from '../../core/error';
import type { PersonaRole } from '../../core/types';

@Component({
  selector: 'app-create-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="create-page">
      <a routerLink="/profiles" class="back-link">← Back</a>
      <h2>Create profile</h2>

      <form (ngSubmit)="submit()" #f="ngForm" novalidate>
        <label>
          Username
          <input
            name="username" [(ngModel)]="username" required
            [attr.aria-describedby]="error() ? 'form-error' : null"
          />
        </label>

        <label>
          Password <small>(min 8 characters)</small>
          <input name="password" type="password" [(ngModel)]="password" required minlength="8" />
        </label>

        <label>
          Role
          <select name="role" [(ngModel)]="role" required>
            <option value="Admin">Admin</option>
            <option value="Academic Affairs">Academic Affairs</option>
            <option value="Teacher">Teacher</option>
          </select>
        </label>

        @if (error()) {
          <p id="form-error" class="error" role="alert">{{ error() }}</p>
        }

        <button type="submit" class="btn-primary" [disabled]="loading()">
          {{ loading() ? 'Creating…' : 'Create profile' }}
        </button>
      </form>

      <p class="local-notice">
        ⚠ This is a local-machine convenience safeguard, not a security boundary.
        Clearing browser data removes all profiles.
      </p>
    </div>
  `,
  styleUrl: './create-profile.component.scss',
})
export class CreateProfileComponent {
  protected username = '';
  protected password = '';
  protected role: PersonaRole = 'Teacher';
  protected error = signal<string | null>(null);
  protected loading = signal(false);

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  async submit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.createProfile({ username: this.username, password: this.password, role: this.role });
      this.router.navigate(['/profiles']);
    } catch (e) {
      if (e instanceof AppException) {
        const err = e.error;
        this.error.set('detail' in err ? err.detail : err.code);
      } else {
        this.error.set('An unexpected error occurred.');
      }
    } finally {
      this.loading.set(false);
    }
  }
}
