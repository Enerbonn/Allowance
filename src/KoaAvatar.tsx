import koa from './assets/Koa.png';
import './koa-avatar.css';

/** Decorative identity beside a visible Koa label or an accessible button name. */
export function KoaAvatar({ size = 24 }: { size?: number }) {
  return <img className="koa-avatar" src={koa} alt="" aria-hidden="true"
    width={Math.max(24, size)} height={Math.max(24, size)} style={{ width: Math.max(24, size), height: Math.max(24, size) }} />;
}
