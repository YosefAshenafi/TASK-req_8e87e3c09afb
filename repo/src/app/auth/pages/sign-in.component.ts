import { Component, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="sign-in-page">
      <a routerLink="/profiles" class="back-link">← All profiles</a>
      <h2>Sign in as {{ username() }}</h2>

      @if (lockedUntil()) {
        <div class="lockout-banner" role="alert" aria-live="assertive">
          <strong>Account locked.</strong>
          Locked due to too many failed attempts. Try again in
          <strong>{{ lockoutMinutesLeft() }} minute(s)</strong>.
          <br />
          <small>Clearing browser data will also unlock this profile.</small>
        </div>
      }

      <form (ngSubmit)="submit()" #f="ngForm" novalidate [class.hidden]="!!lockedUntil()">
        <label>
          Password
          <input
            name="password"
            type="password"
            [(ngModel)]="password"
            required
            [attr.aria-describedby]="error() ? 'sign-in-error' : null"
            autofocus
          />
        </label>

        @if (error()) {
          <p id="sign-in-error" class="error" role="alert">{{ error() }}</p>
        }

        <button type="submit" class="btn-primary" [disabled]="loading()">
          {{ loading() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  `,
  styleUrl: './sign-in.component.scss',
})
export class SignInComponent implements OnInit {
  protected username = signal('');
  protected password = '';
  protected error = signal<string | null>(null);
  protected loading = signal(false);
  protected lockedUntil = signal<number | null>(null);
  protected lockoutMinutesLeft = computed(() => {
    const until = this.lockedUntil();
    if (!until) return 0;
    return Math.ceil((until - Date.now()) / 60_000);
  });

  private profileId = '';

  constructor(
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    this.profileId = this.route.snapshot.paramMap.get('profileId') ?? '';
    const profiles = await this.auth.listProfiles();
    const profile = profiles.find(p => p.id === this.profileId);
    if (!profile) {
      this.router.navigate(['/profiles']);
      return;
    }
    this.username.set(profile.username);
    if (profile.lockoutUntil && profile.lockoutUntil > Date.now()) {
      this.lockedUntil.set(profile.lockoutUntil);
    }
  }

  async submit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const result = await this.auth.signIn(this.username(), this.password);
      if (result.ok) {
        this.router.navigate(['/persona']);
      } else if (result.reason === 'LockedOut') {
        this.lockedUntil.set(result.until);
      } else {
        const rem = result.attemptsRemaining;
        this.error.set(
          `Incorrect password. ${rem} attempt${rem !== 1 ? 's' : ''} remaining before lockout.`,
        );
      }
    } finally {
      this.loading.set(false);
    }
  }
}
