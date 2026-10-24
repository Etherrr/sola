'use client';
import { createContext, useContext, useState } from 'react';
import type { TrackNetwork } from './api-client';

// One shared network selection for the Track page: the top-bar selector and the form chips are
// two controls for the same choice, so they read and write a single state instead of disagreeing.
const TrackNetworkContext = createContext<{
  network: TrackNetwork;
  setNetwork: (n: TrackNetwork) => void;
}>({ network: 'ethereum', setNetwork: () => undefined });

export function TrackNetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<TrackNetwork>('ethereum');
  return (
    <TrackNetworkContext.Provider value={{ network, setNetwork }}>
      {children}
    </TrackNetworkContext.Provider>
  );
}

export function useTrackNetwork() {
  return useContext(TrackNetworkContext);
}
