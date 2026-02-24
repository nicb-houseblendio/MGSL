import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { NetSuiteContext as NSContextType } from '@/types';

const defaultContext: NSContextType = {
  userId: '',
  userName: '',
  subsidiaryId: '',
  subsidiaryName: '',
  accountId: '',
  restletUrl: '',
};

const NetSuiteContext = createContext<NSContextType>(defaultContext);

export const NetSuiteProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo(() => {
    const win = typeof window !== 'undefined' ? window : null;
    const raw = (win as { __NS_CONTEXT__?: NSContextType })?.__NS_CONTEXT__;
    if (raw && typeof raw === 'object' && raw.restletUrl) {
      return raw as NSContextType;
    }
    return defaultContext;
  }, []);

  return (
    <NetSuiteContext.Provider value={value}>
      {children}
    </NetSuiteContext.Provider>
  );
};

export const useNetSuite = () => {
  const context = useContext(NetSuiteContext);
  if (!context) {
    throw new Error('useNetSuite must be used within NetSuiteProvider');
  }
  return context;
};
