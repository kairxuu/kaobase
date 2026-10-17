import {describe,expect,it} from 'vitest';
import {appIconSource} from '@/lib/app-icons';

describe('logos des apps',()=>{
  it('sert les logos connus depuis le projet',()=>{
    expect(appIconSource('https://www.amazon.fr/gp/your-account?token=private')).toBe('/app-icons/amazon.fr.png');
    expect(appIconSource('https://www.notion.com/workspace')).toBe('/app-icons/notion.so.png');
    expect(appIconSource('https://mail.google.com/mail/u/0')).toBe('/app-icons/mail.google.com.png');
  });
  it('transmet uniquement le domaine public au fournisseur',()=>{
    expect(appIconSource('https://my-service.fr/account/alex?token=private#secret')).toBe('https://icon.horse/icon/my-service.fr');
    expect(appIconSource('https://amazon.fr.evil.com/')).toBe('https://icon.horse/icon/amazon.fr.evil.com');
  });
  it.each([null,undefined,'not a URL','javascript:alert(1)','https://user:secret@example.com','http://localhost:3000/','https://127.0.0.1/','https://[::1]/','https://intranet.local/','https://service.internal/','https://example.test/'])('ne recherche pas une icône pour %s',value=>{
    expect(appIconSource(value)).toBeNull();
  });
});
