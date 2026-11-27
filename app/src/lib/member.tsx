import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useSession } from "./session";

export interface MemberInfo {
  id: string;
  name: string;
}

const Ctx = createContext<{ members: MemberInfo[]; current: string | null; setCurrent: (id: string) => void; q: (path: string) => string }>({
  members: [],
  current: null,
  setCurrent: () => {},
  q: (p) => p,
});

/** Which member (business) the member area is acting for, when one email manages several. */
export function MemberProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!session.member) {
      setMembers([]);
      setCurrent(null);
      return;
    }
    api<{ members: MemberInfo[] }>("/v1/member/me", { role: "member" })
      .then((r) => {
        setMembers(r.members);
        setCurrent((c) => c ?? r.members[0]?.id ?? null);
      })
      .catch(() => setMembers([]));
  }, [session.member]);
  // Adds ?member_id=… so every call is explicit about which business it is for.
  const q = (path: string) => (current ? `${path}${path.includes("?") ? "&" : "?"}member_id=${current}` : path);
  return <Ctx.Provider value={{ members, current, setCurrent, q }}>{children}</Ctx.Provider>;
}

export const useMember = () => useContext(Ctx);
