import { createContext, useContext, useCallback, type ReactNode } from 'react';

export interface HelpPanelContextValue {
  setToolsContent: (content: ReactNode) => void;
  setToolsOpen: (open: boolean) => void;
}

const HelpPanelContext = createContext<HelpPanelContextValue | null>(null);

export function useHelpPanel(): HelpPanelContextValue {
  const context = useContext(HelpPanelContext);
  if (!context) {
    throw new Error('useHelpPanel must be used within a HelpPanelProvider. Wrap your component tree with <HelpPanelProvider>.');
  }
  return context;
}

export function HelpPanelProvider({
  children,
  onToolsContentChange,
  onToolsOpenChange,
}: {
  children: ReactNode;
  onToolsContentChange: (content: ReactNode) => void;
  onToolsOpenChange: (open: boolean) => void;
}) {
  const setToolsContent = useCallback(
    (content: ReactNode) => {
      onToolsContentChange(content);
    },
    [onToolsContentChange],
  );

  const setToolsOpen = useCallback(
    (open: boolean) => {
      onToolsOpenChange(open);
    },
    [onToolsOpenChange],
  );

  return <HelpPanelContext.Provider value={{ setToolsContent, setToolsOpen }}>{children}</HelpPanelContext.Provider>;
}
