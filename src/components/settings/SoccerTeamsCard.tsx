import { useEffect, useState } from "react";
import { Trophy, X } from "lucide-react";
import {
  SOCCER_LEAGUES,
  fetchLeagueTeams,
  loadSoccerTeams,
  removeAllSoccerEvents,
  saveSoccerTeams,
  syncSoccerFixtures,
  type SoccerTeam,
} from "../../lib/soccerFixtures";
import { teamNameJa } from "../../lib/soccerTeamNames";
import { pushSoccerTeams, syncSoccerTeams } from "../../lib/soccerTeamsSync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Select } from "../ui/Select";
import { useToast } from "../ui/ToastProvider";

/**
 * 設定の「海外サッカー」。見たいチームを選ぶと、そのチームのリーグ戦・CL/EL の日程が予定に入る(日本時間)。
 * 選び直すと、外したチームの今後の試合は予定から消える。しくみは src/lib/soccerFixtures.ts。
 */
export function SoccerTeamsCard() {
  const [teams, setTeams] = useState<SoccerTeam[]>(() => loadSoccerTeams());
  const [leagueSlug, setLeagueSlug] = useState("");
  const [leagueTeams, setLeagueTeams] = useState<SoccerTeam[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  // 別の端末で選んだチームに追いつく(開いた時に1回)。
  useEffect(() => {
    let cancelled = false;
    void syncSoccerTeams().then((latest) => {
      if (!cancelled) setTeams(latest);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSync(next: SoccerTeam[], quietIfNothing = false) {
    setBusy(true);
    try {
      if (next.length === 0) {
        const removed = await removeAllSoccerEvents();
        if (removed > 0) showToast(`今後のサッカーの試合 ${removed} 件を予定から外しました`);
        return;
      }
      const r = await syncSoccerFixtures(next);
      if (r.failedTeams > 0) {
        showToast(`${r.failedTeams} チームの日程を取れませんでした。少し待ってからもう一度お試しください`, "error");
      } else if (r.added + r.updated + r.removed > 0) {
        showToast(`試合を取り込みました(追加 ${r.added}・変更 ${r.updated}・削除 ${r.removed})`);
      } else if (!quietIfNothing) {
        showToast("新しい試合はありませんでした");
      }
    } catch {
      showToast("日程を取れませんでした。通信を確かめてもう一度お試しください", "error");
    } finally {
      setBusy(false);
    }
  }

  function update(next: SoccerTeam[]) {
    setTeams(next);
    saveSoccerTeams(next);
    void pushSoccerTeams(next);
    void runSync(next, true);
  }

  async function handleLeague(slug: string) {
    setLeagueSlug(slug);
    setLeagueTeams([]);
    if (!slug) return;
    setLoadingTeams(true);
    try {
      setLeagueTeams(await fetchLeagueTeams(slug));
    } catch {
      showToast("チーム一覧を取れませんでした。通信を確かめてもう一度お試しください", "error");
    } finally {
      setLoadingTeams(false);
    }
  }

  function handleAdd(teamId: string) {
    const team = leagueTeams.find((t) => t.id === teamId);
    if (!team || teams.some((t) => t.id === team.id)) return;
    update([...teams, team]);
  }

  return (
    <Card className="system-section system-section--soccer">
      <div className="system-section__header">
        <div className="system-section__identity">
          <span>
            <Trophy size={17} />
          </span>
          <div>
            <h2>海外サッカー</h2>
          </div>
        </div>
        <div className={`system-status ${teams.length > 0 ? "is-online" : ""}`}>
          <i />
          {teams.length > 0 ? `${teams.length} チーム` : "未設定"}
        </div>
      </div>
      <p className="system-section__description text-xs text-slate-500">
        見たいチームを選ぶと、そのチームのリーグ戦とCL/ELの日程が、日本時間で予定に入ります(カップ戦は入りません)。
        ネットの日程から取るので、延期や時間の変更は次に開いた時(6時間おき)に直ります。
      </p>

      {teams.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="選んでいるチーム">
          {teams.map((team) => (
            <li key={team.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => update(teams.filter((t) => t.id !== team.id))}
                aria-label={`${teamNameJa(team.name)}を外す`}
                className="inline-flex min-h-11 items-center gap-1.5 border border-white/60 bg-white/35 px-3 text-sm"
              >
                {teamNameJa(team.name)}
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Select label="リーグ" value={leagueSlug} onChange={(e) => void handleLeague(e.target.value)}>
        <option value="">リーグを選ぶ</option>
        {SOCCER_LEAGUES.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.label}
          </option>
        ))}
      </Select>
      {leagueSlug && (
        <Select
          label="チームを追加"
          value=""
          disabled={loadingTeams || busy}
          onChange={(e) => handleAdd(e.target.value)}
        >
          <option value="">{loadingTeams ? "読み込み中…" : "チームを選ぶ"}</option>
          {leagueTeams.map((t) => (
            <option key={t.id} value={t.id} disabled={teams.some((x) => x.id === t.id)}>
              {t.name}
              {teams.some((x) => x.id === t.id) ? "(選択済み)" : ""}
            </option>
          ))}
        </Select>
      )}

      {teams.length > 0 && (
        <div className="system-section__actions">
          <Button variant="secondary" className="w-full" disabled={busy} onClick={() => void runSync(teams)}>
            {busy ? "取り込み中…" : "今すぐ取り込む"}
          </Button>
        </div>
      )}
    </Card>
  );
}
