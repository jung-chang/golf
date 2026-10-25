import { Component, type ReactNode } from 'react';
export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="status" className="absolute top-24 inset-x-4 rounded-xl bg-black/80 p-4 text-sm text-white">Map unavailable. Shot tracking and scoring still work; missing locations can be edited later.</p> : this.props.children;
  }
}
