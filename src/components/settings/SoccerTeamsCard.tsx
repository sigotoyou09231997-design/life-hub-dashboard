import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Trophy, X } from "lucide-react";
import {
  SOCCER_LEAGUES,
  fetchLeagueTeams,
  loadSoccerTeams,
  removeAllSoccerEvents,
  saveSoccerTeams,
  soccerCrestUrl,
  syncSoccerFixtures,
  type SoccerTeam,
} from "../../lib/soccerFixtures";
import { teamNameJa } from "../../lib/soccerTeamNames";
import { pushSoccerTeams, syncSoccerTeams } from "../../lib/soccerTeamsSync";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";
import { useToast } from "../ui/ToastProvider";

type LeagueState = { status: "loading" } | { status: "error" } | { status: "ready"; teams: SoccerTeam[] };

/** 紋章。読み込めない時(通信が切れている・画像が無い)は、頭文字の丸にする。 */
function Crest({ team, size = 28 }: { team: SoccerTeam; size?: number }) {
  const [broken, setBroken] = useState(false);
  const name = teamNameJa(team.name);
  return broken ? (
    <span className="soccer-crest soccer-crest--blank" style={{ width: size, height: size }} aria-hidden>
      {name.slice(0, 1)}
    </span>
  ) : (
    <img
      className="soccer-crest"
      src={soccerCrestUrl(team.id)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * 設定の「海外サッカー」。見たいチームを選ぶと、そのチームのリーグ戦・CL/EL の日程が予定に入る(日本時間)。
 * 上に「選んだチーム」をリーグごとに並べ、下で「リーグを切り替えながら、紋章つきのチームを押して選ぶ」。
 * 選び直すと、外したチームの今後の試合は予定から消える。しくみは src/lib/soccerFixtures.ts、見た目は src/styles/soccer.css。
 */
export function SoccerTeamsCard() {
  const [teams, setTeams] = useState<SoccerTeam[]>(() => loadSoccerTeams());
  const [leagueSlug, setLeagueSlug] = useState(
    () => SOCCER_LEAGUES.find((l) => loadSoccerTeams().some((t) => t.league === l.label))?.slug ?? SOCCER_LEAGUES[0].slug,
  );
  const [leagues, setLeagues] = useState<Record<string, LeagueState>>({});
  const [retry, setRetry] = useState(0);
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

  // 見ているリーグのチーム一覧(一度読んだら、切り替えても読み直さない)。
  useEffect(() => {
    const state = leagues[leagueSlug]?.status;
    if (state === "ready" || state === "loading") return;
    setLeagues((prev) => ({ ...prev, [leagueSlug]: { status: "loading" } }));
    // リーグごとの入れ物に書くだけなので、読み込み中に別のリーグへ切り替えても、書き込みは止めない。
    fetchLeagueTeams(leagueSlug)
      .then((list) => setLeagues((prev) => ({ ...prev, [leagueSlug]: { status: "ready", teams: list } })))
      .catch(() => setLeagues((prev) => ({ ...prev, [leagueSlug]: { status: "error" } })));
    // leagues は読み込みの結果で変わるので、依存に入れると読み込みが二重に走る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueSlug, retry]);

  const groups = useMemo(() => {
    const known = SOCCER_LEAGUES.map((l) => ({ key: l.slug, label: l.label, teams: teams.filter((t) => t.league === l.label) }));
    const other = teams.filter((t) => !SOCCER_LEAGUES.some((l) => l.label === t.league));
    return [...known, { key: "other", label: "その他", teams: other }].filter((g) => g.teams.length > 0);
  }, [teams]);

  const selectedIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);
  const countIn = (label: string) => teams.filter((t) => t.league === label).length;

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

  function toggle(team: SoccerTeam) {
    update(selectedIds.has(team.id) ? teams.filter((t) => t.id !== team.id) : [...teams, team]);
  }

  const current = leagues[leagueSlug];

  return (
    <div className="soccer lg:col-span-2">
      <div className="soccer__hero">
        <div className="soccer__hero-top">
          <span className="soccer__kicker">
            <Trophy size={14} aria-hidden />
            海外サッカー
          </span>
          <span className="soccer__count" aria-label={`${teams.length} チーム`}>
            <strong>{teams.length}</strong>
            <small>チーム</small>
          </span>
        </div>
        <p className="soccer__lead">
          見たいチームを選ぶと、リーグ戦とCL/ELの日程が日本時間で予定に入ります(カップ戦は入りません)。
        </p>
        {teams.length > 0 && (
          <div className="soccer__stack" aria-hidden>
            {teams.slice(0, 8).map((t) => (
              <span key={t.id} className="soccer__stack-item">
                <Crest team={t} size={30} />
              </span>
            ))}
            {teams.length > 8 && <span className="soccer__stack-more">+{teams.length - 8}</span>}
          </div>
        )}
      </div>

      <div className="soccer__body">
        <section aria-label="選んでいるチーム" className="soccer__section">
          <h3 className="soccer__heading">選んだチーム</h3>
          {groups.length === 0 ? (
            <p className="soccer__empty">まだ選んでいません。下のリーグから、見たいチームを押してください。</p>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="soccer__group">
                <p className="soccer__group-name">{g.label}</p>
                <ul className="soccer__chips">
                  {g.teams.map((team) => (
                    <li key={team.id}>
                      <button
                        type="button"
                        className="soccer__chip"
                        disabled={busy}
                        onClick={() => update(teams.filter((t) => t.id !== team.id))}
                        aria-label={`${teamNameJa(team.name)}を外す`}
                      >
                        <Crest team={team} size={20} />
                        <span>{teamNameJa(team.name)}</span>
                        <X size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section aria-label="チームを選ぶ" className="soccer__section">
          <h3 className="soccer__heading">チームを選ぶ</h3>
          <Tabs
            options={SOCCER_LEAGUES.map((l) => ({
              value: l.slug,
              label: countIn(l.label) > 0 ? `${l.short} ${countIn(l.label)}` : l.short,
            }))}
            value={leagueSlug}
            onChange={setLeagueSlug}
          />
          {current?.status === "error" ? (
            <div className="soccer__notice" role="alert">
              <p>チーム一覧を取れませんでした。通信を確かめてください。</p>
              <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
                もう一度読み込む
              </Button>
            </div>
          ) : current?.status === "ready" ? (
            <ul className="soccer__grid">
              {current.teams.map((team) => {
                const picked = selectedIds.has(team.id);
                return (
                  <li key={team.id}>
                    <button
                      type="button"
                      className={`soccer__tile${picked ? " is-picked" : ""}`}
                      aria-pressed={picked}
                      disabled={busy}
                      onClick={() => toggle(team)}
                    >
                      <Crest team={team} size={32} />
                      <span className="soccer__tile-name">{team.name}</span>
                      {picked && <Check size={16} className="soccer__tile-check" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="soccer__grid" aria-busy="true" aria-label="読み込み中">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="soccer__tile soccer__tile--skeleton" />
              ))}
            </ul>
          )}
        </section>

        {teams.length > 0 && (
          <Button variant="secondary" className="soccer__sync" disabled={busy} onClick={() => void runSync(teams)}>
            <RefreshCw size={16} aria-hidden className={busy ? "animate-spin" : ""} />
            {busy ? "取り込み中…" : "今すぐ取り込む"}
          </Button>
        )}
        <p className="soccer__note">ネットの日程から取るので、延期や時間の変更は次に開いた時(6時間おき)に直ります。</p>
      </div>
    </div>
  );
}
