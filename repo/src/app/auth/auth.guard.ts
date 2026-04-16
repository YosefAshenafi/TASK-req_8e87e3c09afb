import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { map, switchMap, take } from 'rxjs/operators';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait for enforceAutoSignOut to finish (ready$ emits once, then complete),
  // then take the definitive snapshot of currentProfile$.
  return auth.ready$.pipe(
    switchMap(() => auth.currentProfile$.pipe(take(1))),
    map(profile => {
      if (profile) return true;
      return router.createUrlTree(['/profiles']);
    }),
  );
};
