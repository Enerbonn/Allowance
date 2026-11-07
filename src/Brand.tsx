import logo from './assets/KoaSpend.png';
import mascot from './assets/Mascot2.png';

export function Brand() {
  return <div className="brand koaspend-brand">
    <img src={logo} alt="" width={44} height={44}/>
    <strong>KoaSpend</strong>
  </div>;
}

export function AuthBrandingPanel() {
  return <aside className="welcome-art koaspend-art">
    <Brand/>
    <div className="koaspend-hero">
      <img src={mascot} alt="" width={432} height={578}/>
      <h1>Smart spending,<br/>zero effort.<br/>Just like a <span>koala.</span></h1>
    </div>
  </aside>;
}
