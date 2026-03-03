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

interface NSConfig {
  restletUrl?: string;
  userId?: string | number;
  userName?: string;
  userRole?: string;
  accountId?: string;
  subsidiary?: { id: string | number; name: string };
  uomConfig?: Record<string, string[]>;
}

export const NetSuiteProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo(() => {
    const win = typeof window !== 'undefined' ? window : null;
    const mcgi = (win as { MCGI_CONFIG?: NSConfig & NSContextType })?.MCGI_CONFIG;
    const legacyConfig = (win as { __NS_CONFIG__?: NSConfig })?.__NS_CONFIG__;
    const legacyCtx = (win as { __NS_CONTEXT__?: NSContextType })?.__NS_CONTEXT__;
    const raw = mcgi ?? legacyConfig ?? legacyCtx;
    if (raw && typeof raw === 'object' && (raw.restletUrl || (raw as NSContextType).restletUrl)) {
      const r = raw as NSConfig & NSContextType;
      return {
        userId: String(r.userId ?? ''),
        userName: r.userName ?? '',
        subsidiaryId: String(r.subsidiary?.id ?? r.subsidiaryId ?? ''),
        subsidiaryName: r.subsidiary?.name ?? r.subsidiaryName ?? '',
        accountId: String(r.accountId ?? ''),
        restletUrl: r.restletUrl ?? '',
        uomConfig: r.uomConfig,
      } as NSContextType;
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
