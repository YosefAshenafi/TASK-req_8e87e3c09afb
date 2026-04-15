import { TestBed } from '@angular/core/testing';
import { TabIdentityService } from './tab-identity.service';

describe('TabIdentityService', () => {
  let service: TabIdentityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TabIdentityService);
  });

  it('assigns a valid UUID as tabId', () => {
    expect(service.tabId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('assigns a colour from the palette', () => {
    expect(service.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
