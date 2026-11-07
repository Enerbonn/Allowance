import koa from './assets/Koa.svg';
import './koa-avatar.css';

/** Decorative identity beside a visible Koa label or an accessible button name. */
export function KoaAvatar({ size = 24 }: { size?: number }) {
  return <img className="koa-avatar" src={koa} alt="" aria-hidden="true"
    width={Math.max(28, size)} height={Math.max(28, size)} style={{ width: Math.max(28, size), height: Math.max(28, size) }} />;
}
