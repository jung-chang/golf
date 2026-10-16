// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '../src/components/ui/drawer';

function Sheet({ historyManaged = false }: { historyManaged?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open tools</button><Drawer historyManaged={historyManaged} open={open} onOpenChange={setOpen}><DrawerContent><DrawerHeader><DrawerTitle>Tools</DrawerTitle><DrawerDescription>Test sheet</DrawerDescription></DrawerHeader></DrawerContent></Drawer></>;
}
afterEach(async () => { cleanup(); await new Promise((resolve) => setTimeout(resolve, 20)); });

describe('sheet navigation', () => {
  it('adds one history entry under StrictMode and Back dismisses it without leaving the page', async () => {
    history.replaceState(null, '', '/#golf');
    const before = history.length;
    render(<StrictMode><Sheet /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tools' }));
    await screen.findByRole('dialog');
    expect(history.length).toBe(before + 1);
    history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location.hash).toBe('#golf');
    expect(history.state).toBeNull();
  });
  it('removes the local entry when the visible close button is used', async () => {
    history.replaceState(null, '', '/#golf');
    render(<Sheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Open tools' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(history.state).toBeNull());
    expect(location.hash).toBe('#golf');
  });
  it('leaves URL-managed detail history to its screen', async () => {
    history.replaceState({ sheet: true }, '', '/#games/example');
    const before = history.length;
    render(<Sheet historyManaged />);
    fireEvent.click(screen.getByRole('button', { name: 'Open tools' }));
    await screen.findByRole('dialog');
    expect(history.length).toBe(before);
    expect(history.state).toEqual({ sheet: true });
  });
});
