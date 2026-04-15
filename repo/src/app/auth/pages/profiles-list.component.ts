import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth.service';
import type { ProfileSummary } from '../profile.model';

@Component({
  selector: 'app-profiles-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="profiles-page">
      <h1>SecureRoom Brainstorm Studio</h1>
      <p class="subtitle">Select a profile to sign in, or create a new one.</p>

      <ul class="profile-list" role="list">
        @for (profile of profiles(); track profile.id) {
          <li>
            <button
              class="profile-card"
              [attr.aria-disabled]="isLockedOut(profile)"
              (click)="selectProfile(profile)"
            >
              <span class="profile-name">{{ profile.username }}</span>
              <span class="profile-role">{{ profile.role }}</span>
              @if (isLockedOut(profile)) {
                <span class="lockout-badge" aria-live="polite">
                  Locked — wait {{ lockoutMinutes(profile) }} min
                </span>
              }
            </button>
          </li>
        }
        @empty {
          <li class="empty-state">No profiles yet. Create one to get started.</li>
        }
      </ul>

      <a routerLink="/profiles/new" class="btn-primary">Create new profile</a>

      <p class="local-notice">
        ⚠ Profiles are stored locally on this device. Clearing browser data will remove all profiles and data.
      </p>
    </div>
  `,
  styleUrl: './profiles-list.component.scss',
})
export class ProfilesListComponent implements OnInit {
  protected profiles = signal<ProfileSummary[]>([]);

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    this.profiles.set(await this.auth.listProfiles());
  }

  protected isLockedOut(p: ProfileSummary): boolean {
    return p.lockoutUntil !== null && p.lockoutUntil > Date.now();
  }

  protected lockoutMinutes(p: ProfileSummary): number {
    if (!p.lockoutUntil) return 0;
    return Math.ceil((p.lockoutUntil - Date.now()) / 60_000);
  }

  protected selectProfile(profile: ProfileSummary): void {
    if (this.isLockedOut(profile)) return;
    this.router.navigate(['/sign-in', profile.id]);
  }
}
