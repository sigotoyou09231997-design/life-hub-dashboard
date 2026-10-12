import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getSharedOwnersSnapshot, subscribeSharedOwners, subscribeTripMembersChanged } from "../lib/sharedTrips";
import { collabErrorText, listCollaborators, listIncomingInvites, type Collaborator } from "../lib/tripCollab";

/** 他人から共有された旅行(旅行の id → 持ち主)。同期が確かめるたびに最新になる。 */
export function useSharedTripOwners(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribeSharedOwners, getSharedOwnersSnapshot, getSharedOwnersSnapshot);
}

/** この旅行は、他人の旅行に招かれて一緒に編集しているものか。 */
export function useIsSharedWithMe(tripId: string | undefined): boolean {
  const owners = useSharedTripOwners();
  return Boolean(tripId && owners.has(tripId));
}

/** 自分宛ての、承認待ちの招待。届いた時(リアルタイム)・アプリに戻った時に取り直す。 */
export function useIncomingInvites(): Collaborator[] {
  const [invites, setInvites] = useState<Collaborator[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => {
      void listIncomingInvites().then((list) => {
        if (active) setInvites(list);
      });
    };
    load();
    const stop = subscribeTripMembersChanged(load);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return invites;
}

export interface CollaboratorsState {
  /** まだ読んでいない間は null。 */
  items: Collaborator[] | null;
  /** 読めなかった時の、画面に出す文。 */
  error: string | null;
  reload: () => void;
}

/** この旅行の招待・参加者。開いている間、参加や招待の変化(リアルタイム)で取り直す。 */
export function useCollaborators(tripId: string): CollaboratorsState {
  const [items, setItems] = useState<Collaborator[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => subscribeTripMembersChanged(reload), [reload]);

  useEffect(() => {
    let active = true;
    void listCollaborators(tripId).then(
      (list) => {
        if (!active) return;
        setItems(list);
        setError(null);
      },
      (failure: unknown) => {
        if (!active) return;
        setError(collabErrorText(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [tripId, version]);

  return { items, error, reload };
}
