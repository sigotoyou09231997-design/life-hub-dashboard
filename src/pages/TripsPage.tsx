import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { db } from "../db/schema";
import { todayStr } from "../lib/date";
import { deleteAttachmentsForAll } from "../lib/attachments";
import { deleteCurrencyFor } from "../lib/currency";
import { endTripShare } from "../lib/tripShare";
import { readSharedOwners } from "../lib/sharedTrips";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { PageFab } from "../components/ui/PageFab";
import { Card } from "../components/ui/Card";
import { EmptyIllustration } from "../components/ui/EmptyIllustration";
import { TripForm } from "../components/trips/TripForm";
import { TripLeadCard } from "../components/trips/TripLeadCard";
import { TripPlanCard } from "../components/trips/TripPlanCard";
import { TripArchiveList } from "../components/trips/TripArchiveList";
import { TripNewCard } from "../components/trips/TripNewCard";
import { TripInviteBanner } from "../components/trips/TripInviteBanner";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";
import { splitTrips } from "../lib/tripListSections";
import { useTripsStatus } from "../hooks/usePageStatus";

export async function deleteTripCascade(tripId: string) {
  // 招かれて一緒に編集している旅行は、参加者には消せない(消すと、持ち主と、ほかの参加者の旅行まで消える)。
  // 画面では消すボタンを出していないが、ここでも止める。抜けるのは、旅行の「一緒に編集」から。
  if (readSharedOwners().has(tripId)) return;
  // 日記は旅行の中でしか読めない(単独の画面は無い)ので、紐づけを外すと
  // どこからも辿れない行が残ってしまう。旅行と一緒に消す — 削除の確認文でも
  // 日記が消えることを明記している。
  const diaryIds = (await db.diaryEntries.toArray())
    .filter((entry) => entry.tripId === tripId)
    .map((entry) => entry.id!)
    .filter(Boolean);
  await Promise.all(diaryIds.map((id) => db.diaryEntries.delete(id)));
  // 日記に貼った写真は別のテーブルにあるので、日記を消しただけでは残る
  // (src/lib/attachments.ts)。
  await deleteAttachmentsForAll("diary", diaryIds);

  // 書類ポケットも、貼った写真が別のテーブルにあるので先にidを控えてから消す
  // (日記と同じ理由。src/lib/attachments.ts)。
  const documentIds = (await db.tripDocuments.where("tripId").equals(tripId).toArray())
    .map((document) => document.id!)
    .filter(Boolean);
  await deleteAttachmentsForAll("tripDocument", documentIds);
  // 予定に貼った写真も同じ。予定を消す前に id を控えて落とす。
  const scheduleIds = (await db.tripSchedule.where("tripId").equals(tripId).toArray())
    .map((item) => item.id!)
    .filter(Boolean);
  await deleteAttachmentsForAll("tripSchedule", scheduleIds);

  // 現地通貨で入れた支出の内訳も別のテーブルなので、支出を消す前にidを控えて落とす
  // (src/lib/currency.ts)。残すと、どの支出のものか辿れない行だけが貯まる。
  const expenseIds = (await db.tripExpenses.where("tripId").equals(tripId).toArray())
    .map((expense) => expense.id!)
    .filter(Boolean);
  await Promise.all(expenseIds.map((id) => deleteCurrencyFor(id)));

  await Promise.all([
    db.tripSchedule.where("tripId").equals(tripId).delete(),
    db.tripExpenses.where("tripId").equals(tripId).delete(),
    db.tripPackingItems.where("tripId").equals(tripId).delete(),
    db.tripRoutePlaces.where("tripId").equals(tripId).delete(),
    db.tripDocuments.where("tripId").equals(tripId).delete(),
  ]);
  await db.trips.delete(tripId);

  // 共有していた旅行なら、その合鍵も落とす(src/lib/tripShare.ts)。これは端末内では
  // なく Supabase にしか無いので、消し損ねると中身の無いリンクだけが残る。
  // 通信できない時に消せなくても旅行の削除そのものは終わっているので、待たない・
  // 失敗しても止めない — その場合リンクは「共有は終了しました」になる(旅行が無いため)。
  void endTripShare(tripId).catch((error) => {
    console.error("[share] failed to drop the share of a deleted trip:", error);
  });
}

export default function TripsPage() {
  const tripsStatus = useTripsStatus();
  const navigate = useNavigate();
  const showToast = useToast();
  const [creating, setCreating] = useState(false);
  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const trips = tripsResult ?? [];
  const showSkeleton = useDelayedFlag(tripsResult === undefined);

  const { lead, upcoming, past } = splitTrips(trips, todayStr());

  function handleDelete(id: string) {
    deleteTripCascade(id);
    showToast("削除しました");
  }

  return (
    <div className="spatial-page trips-page micro-contrast mx-auto max-w-[1480px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.trips}>
      <PageHeader title="旅行計画" subtitle={tripsStatus ?? ""} backTo="/" />

      {/* 別のアカウントから届いた、旅行への招待(supabase/sql/034)。無い間は何も出ない。 */}
      <TripInviteBanner className="mx-5 mb-3 lg:mx-8" />

      {/* 追加ボタンは他のページと同じ画面右下(src/components/ui/PageFab.tsx)。 */}
      <PageFab onClick={() => setCreating(true)} label="旅行を追加">
        <Plus size={24} />
      </PageFab>

      <div className="destination-workspace px-5 lg:px-8">
        {showSkeleton ? (
          <ListSkeleton />
        ) : trips.length === 0 ? (
          // 旅行が0件のときもこのカード1枚だけなので、下まで伸ばす。このページは
          // タブが無いぶん、他より高く取れる(--plain、index.css)。中身はもともと
          // 縦中央(align-items: center)なので、伸ばすだけで収まる。
          <Card className="destination-empty-control is-empty-fill-self is-empty-fill--plain p-0">
            {/* 飛行機のアイコン1つから、紙飛行機の線画に(UI/UX 調査メモ 第4弾 B-6)。 */}
            <div className="destination-empty-control__visual has-illustration" aria-hidden="true"><EmptyIllustration kind="trip" size={88} /></div>
            <div className="destination-empty-control__copy">
              <span>旅行</span>
              <div><strong>登録済み</strong><b>0</b></div>
              <h2>次の旅を計画しましょう</h2>
              <p>行き先と日程を登録すると、旅程・費用・持ち物をひとつの場所で整理できます。</p>
            </div>
            <div className="destination-empty-control__action">
              <span>次の一歩</span>
              <button type="button" onClick={() => setCreating(true)}><Plus size={15} />旅行を追加</button>
            </div>
          </Card>
        ) : (
          // PCでは、先頭の旅行の右に「新しい旅行」を同じ高さのタイルで並べる(styles/trips.css)。
          // 先頭に立てる旅行が無い時は、「次の旅行を計画する」が横幅いっぱいで先頭に立つ。
          <div className={`trips-board${lead ? " trips-board--lead" : ""}`}>
            {lead ? <TripLeadCard trip={lead} onDelete={handleDelete} /> : <TripNewCard first onClick={() => setCreating(true)} />}
            {/* 右下の「＋」とは別に、一覧の中にも入り口を置く。スマホでは先頭の旅行のすぐ下。 */}
            {lead && <TripNewCard onClick={() => setCreating(true)} />}

            {upcoming.length > 0 && (
              <section className="trips-board__section trips-board__upcoming">
                <div data-page-block>
                  <div className="trips-head">
                    <h2>これから行く</h2>
                    <span>{upcoming.length}</span>
                  </div>
                </div>
                <div className="trip-plan-grid mt-2.5">
                  {upcoming.map((trip) => (
                    <TripPlanCard key={trip.id} trip={trip} onDelete={handleDelete} />
                  ))}
                </div>
              </section>
            )}

            {past.length > 0 && (
              <section className="trips-board__section trips-board__past">
                <div data-page-block>
                  <div className="trips-head">
                    <h2>過去の旅行</h2>
                    <span>{past.length}</span>
                  </div>
                </div>
                <div className="mt-2.5">
                  <TripArchiveList trips={past} onDelete={handleDelete} />
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <Sheet open={creating} onClose={() => setCreating(false)} title="旅行を追加">
        <TripForm
          onSaved={(id) => {
            setCreating(false);
            navigate(`/trips/${id}`);
          }}
          onCancel={() => setCreating(false)}
        />
      </Sheet>
    </div>
  );
}
