import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { AuthService } from './auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // H-07: enforce 7-day auto-signout before any guarded-route decision runs
    provideAppInitializer(async () => {
      try {
        await inject(AuthService).enforceAutoSignOut();
      } catch (err) {
        console.error('[app-init] enforceAutoSignOut failed', err);
      }
    }),
    ...(environment.enableServiceWorker
      ? [
          provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000',
          }),
        ]
      : []),
  ],
};
