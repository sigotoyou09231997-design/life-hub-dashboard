import { useState } from "react";
import { db } from "../../db/schema";
import type { Note, ShoppingItem } from "../../types";
import { moveItem } from "../../lib/noteTypes";
import { NOTE_CATEGORIES } from "../../lib/categories";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ListRow } from "../ui/ListRow";
import { CategorySelect } from "./CategorySelect";
import { Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

interface Props {
  initial?: Note;
  onSaved: () => void;
  onCancel: () => void;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function ShoppingForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(", ") ?? "");
  const [category, setCategory] = useState(initial?.category ?? NOTE_CATEGORIES[0]);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [items, setItems] = useState<ShoppingItem[]>(initial?.shoppingItems ?? []);
  const [newItemName, setNewItemName] = useState("");
  const [saving, setSaving] = useState(false);

  const plannedTotal = items.reduce((sum, i) => sum + (i.price ?? 0), 0);
  const purchasedTotal = items.filter((i) => i.purchased).reduce((sum, i) => sum + (i.price ?? 0), 0);

  // Item add/edit/delete/reorder stay in local state only, exactly like the
  // title/category/pinned fields below — nothing is written to the DB until
  // "保存する" is submitted, so closing with "キャンセル" reverts everything.
  function addItem() {
    if (!newItemName.trim()) return;
    setItems([...items, { id: crypto.randomUUID(), name: newItemName.trim(), purchased: false }]);
    setNewItemName("");
  }

  function togglePurchased(id: string) {
    setItems(items.map((it) => (it.id === id ? { ...it, purchased: !it.purchased } : it)));
  }

  function updateItem(id: string, patch: Partial<ShoppingItem>) {
    setItems(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function deleteItem(id: string) {
    setItems(items.filter((it) => it.id !== id));
  }

  function reorderItem(index: number, direction: -1 | 1) {
    setItems(moveItem(items, index, direction));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const now = Date.now();
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const record: Note = {
      type: "shopping",
      title: title.trim(),
      body,
      tags,
      category,
      pinned,
      shoppingItems: items,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };

    if (initial?.id) {
      await db.notes.put({ ...record, id: initial.id });
    } else {
      await db.notes.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="タイトル" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <CategorySelect value={category} onChange={setCategory} />
      <Input
        label="タグ(カンマ区切り)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="例: 買い物, 仕事"
      />
      <Textarea label="メモ(任意)" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        ピン留めする
      </label>

      <Card>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-400">購入予定額</p>
            <p className="mt-0.5 font-semibold text-slate-900">{yen(plannedTotal)}</p>
          </div>
          <div>
            <p className="text-slate-400">購入済み合計</p>
            <p className="mt-0.5 font-semibold text-success">{yen(purchasedTotal)}</p>
          </div>
        </div>
      </Card>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-600">商品</p>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">商品がありません</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <ListRow key={item.id} className="p-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => togglePurchased(item.id)}
                    aria-label="購入済みを切り替え"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      item.purchased ? "border-success bg-success text-white" : "border-slate-300"
                    }`}
                  >
                    {item.purchased && <Check size={14} strokeWidth={3} />}
                  </button>
                  <input
                    value={item.name}
                    onChange={(e) => updateItem(item.id, { name: e.target.value })}
                    className={`min-w-0 flex-1 border-none bg-transparent text-sm outline-none ${
                      item.purchased ? "text-slate-400 line-through" : "text-slate-900"
                    }`}
                  />
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => reorderItem(index, -1)}
                      disabled={index === 0}
                      aria-label="上へ"
                      className="rounded-full p-1 text-slate-300 transition-colors disabled:opacity-30 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderItem(index, 1)}
                      disabled={index === items.length - 1}
                      aria-label="下へ"
                      className="rounded-full p-1 text-slate-300 transition-colors disabled:opacity-30 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      <ChevronDown size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteItem(item.id)}
                      aria-label="商品を削除"
                      className="rounded-full p-1 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pl-8 text-xs">
                  <label className="flex items-center gap-1 text-slate-400">
                    数量
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={item.quantity ?? ""}
                      onChange={(e) =>
                        updateItem(item.id, {
                          quantity: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                      placeholder="—"
                      className="w-14 rounded-lg border border-white/50 bg-white/40 px-2 py-1 text-slate-900 outline-none focus:border-accent focus:bg-white"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-slate-400">
                    金額
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={item.price ?? ""}
                      onChange={(e) =>
                        updateItem(item.id, {
                          price: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                      placeholder="—"
                      className="w-20 rounded-lg border border-white/50 bg-white/40 px-2 py-1 text-slate-900 outline-none focus:border-accent focus:bg-white"
                    />
                  </label>
                </div>
              </ListRow>
            ))}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <input
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder="商品を追加"
            className="min-w-0 flex-1 rounded-xl border border-white/50 bg-white/40 px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
          />
          <Button type="button" variant="secondary" onClick={addItem}>
            追加
          </Button>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-white/50 bg-white/80 px-5 py-3 backdrop-blur-md">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          保存する
        </Button>
      </div>
    </form>
  );
}
