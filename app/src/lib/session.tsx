import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { clearTokens, hasSession } from "./api";

interface SessionState {
  ready: boolean;
  visitor: boolean;
  member: boolean;
  reload: () => Promise<void>;
  signOut: (role: "visitor" | "member") => Promise<void>;
}

const Ctx = createContext<SessionState>({ ready: false, visitor: false, member: false, reload: async () => {}, signOut: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState({ ready: false, visitor: false, member: false });
  const reload = useCallback(async () => {
    const [visitor, member] = await Promise.all([hasSession("visitor"), hasSession("member")]);
    setS({ ready: true, visitor, member });
  }, []);
  const signOut = useCallback(
    async (role: "visitor" | "member") => {
      await clearTokens(role);
      await reload();
    },
    [reload],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return <Ctx.Provider value={{ ...s, reload, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
