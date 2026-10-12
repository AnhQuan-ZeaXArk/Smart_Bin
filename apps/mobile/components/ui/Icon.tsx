import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

export type IconName =
  | 'dashboard' | 'trash' | 'device' | 'bell' | 'history' | 'user' | 'logout' | 'refresh'
  | 'cpu' | 'camera' | 'radio' | 'server' | 'check-circle' | 'alert-triangle' | 'x-circle'
  | 'activity' | 'eye' | 'eye-off' | 'chevron-right' | 'chevron-left' | 'search' | 'lock'
  | 'recycle' | 'leaf' | 'map-pin' | 'ruler' | 'box' | 'info' | 'wifi' | 'wifi-off' | 'clock' | 'inbox';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/** Stroke icon set shared with the web app (24x24, round caps) so both clients read as one product. */
export const Icon: React.FC<IconProps> = ({ name, size = 18, color = '#C2D0DC', strokeWidth = 1.9 }) => {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  let body: React.ReactNode;

  switch (name) {
    case 'dashboard':
      body = <><Rect x="3" y="3" width="7" height="7" rx="1" {...p} /><Rect x="14" y="3" width="7" height="7" rx="1" {...p} /><Rect x="3" y="14" width="7" height="7" rx="1" {...p} /><Rect x="14" y="14" width="7" height="7" rx="1" {...p} /></>;
      break;
    case 'trash':
      body = <Path d="M3 6h18M8 6V4h8v2m3 0-.9 14H5.9L5 6m4 4v6m6-6v6" {...p} />;
      break;
    case 'device':
    case 'cpu':
      body = <><Rect x="4" y="4" width="16" height="16" rx="2" {...p} /><Rect x="9" y="9" width="6" height="6" {...p} /><Path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" {...p} /></>;
      break;
    case 'bell':
      body = <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4" {...p} />;
      break;
    case 'history':
      body = <Path d="M3 12a9 9 0 1 0 2.64-6.36L3 8m0-5v5h5m4-1v5l3 2" {...p} />;
      break;
    case 'user':
      body = <><Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...p} /><Circle cx="12" cy="7" r="4" {...p} /></>;
      break;
    case 'logout':
      body = <Path d="M10 17l5-5-5-5m5 5H3m9-9h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" {...p} />;
      break;
    case 'refresh':
      body = <><Polyline points="23 4 23 10 17 10" {...p} /><Polyline points="1 20 1 14 7 14" {...p} /><Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" {...p} /></>;
      break;
    case 'camera':
      body = <><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...p} /><Circle cx="12" cy="13" r="4" {...p} /></>;
      break;
    case 'radio':
      body = <><Circle cx="12" cy="12" r="2" {...p} /><Path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" {...p} /></>;
      break;
    case 'server':
      body = <><Rect x="2" y="2" width="20" height="8" rx="2" {...p} /><Rect x="2" y="14" width="20" height="8" rx="2" {...p} /><Line x1="6" y1="6" x2="6.01" y2="6" {...p} /><Line x1="6" y1="18" x2="6.01" y2="18" {...p} /></>;
      break;
    case 'check-circle':
      body = <><Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" {...p} /><Polyline points="22 4 12 14.01 9 11.01" {...p} /></>;
      break;
    case 'alert-triangle':
      body = <><Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" {...p} /><Line x1="12" y1="9" x2="12" y2="13" {...p} /><Line x1="12" y1="17" x2="12.01" y2="17" {...p} /></>;
      break;
    case 'x-circle':
      body = <><Circle cx="12" cy="12" r="10" {...p} /><Line x1="15" y1="9" x2="9" y2="15" {...p} /><Line x1="9" y1="9" x2="15" y2="15" {...p} /></>;
      break;
    case 'activity':
      body = <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" {...p} />;
      break;
    case 'eye':
      body = <><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" {...p} /><Circle cx="12" cy="12" r="3" {...p} /></>;
      break;
    case 'eye-off':
      body = <><Path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" {...p} /><Line x1="1" y1="1" x2="23" y2="23" {...p} /></>;
      break;
    case 'chevron-right':
      body = <Polyline points="9 18 15 12 9 6" {...p} />;
      break;
    case 'chevron-left':
      body = <Polyline points="15 18 9 12 15 6" {...p} />;
      break;
    case 'search':
      body = <><Circle cx="11" cy="11" r="8" {...p} /><Line x1="21" y1="21" x2="16.65" y2="16.65" {...p} /></>;
      break;
    case 'lock':
      body = <><Rect x="3" y="11" width="18" height="11" rx="2" {...p} /><Path d="M7 11V7a5 5 0 0 1 10 0v4" {...p} /></>;
      break;
    case 'recycle':
      body = <Path d="M7 19H4.8a1.8 1.8 0 0 1-1.6-2.6L5 13.5m5-9.4 1.2-2a1.8 1.8 0 0 1 3.1 0L17 6m-8 13h8a2 2 0 0 0 1.8-1.1l1-1.9M10 4l-1 3.5L5.5 6.5M14 4l3.5 1L16.5 8.5M18 14l3 1-1 3.5M9 22l-2.5-2L9 17.5" {...p} />;
      break;
    case 'leaf':
      body = <Path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10zM2 21c0-3 1.9-5.5 6-7" {...p} />;
      break;
    case 'map-pin':
      body = <><Path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" {...p} /><Circle cx="12" cy="10" r="3" {...p} /></>;
      break;
    case 'ruler':
      body = <Path d="M3 17 17 3l4 4L7 21zM8 12l2 2m1-5 2 2m1-5 2 2" {...p} />;
      break;
    case 'box':
      body = <><Path d="M21 8 12 3 3 8v8l9 5 9-5z" {...p} /><Polyline points="3.3 7 12 12 20.7 7" {...p} /><Line x1="12" y1="22" x2="12" y2="12" {...p} /></>;
      break;
    case 'info':
      body = <><Circle cx="12" cy="12" r="10" {...p} /><Line x1="12" y1="16" x2="12" y2="12" {...p} /><Line x1="12" y1="8" x2="12.01" y2="8" {...p} /></>;
      break;
    case 'wifi':
      body = <><Path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0" {...p} /><Line x1="12" y1="20" x2="12.01" y2="20" {...p} /></>;
      break;
    case 'wifi-off':
      body = <><Line x1="1" y1="1" x2="23" y2="23" {...p} /><Path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0" {...p} /><Line x1="12" y1="20" x2="12.01" y2="20" {...p} /></>;
      break;
    case 'clock':
      body = <><Circle cx="12" cy="12" r="10" {...p} /><Polyline points="12 6 12 12 16 14" {...p} /></>;
      break;
    case 'inbox':
      body = <><Polyline points="22 12 16 12 14 15 10 15 8 12 2 12" {...p} /><Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" {...p} /></>;
      break;
    default:
      body = null;
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
};
