import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.currentProfile$.pipe(
    take(1),
    map(profile => {
      if (profile) return true;
      return router.createUrlTree(['/profiles']);
    }),
  );
};
