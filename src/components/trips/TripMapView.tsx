import { ExternalLink, MapPin } from "lucide-react";
import { buildMapEmbedUrl, buildMapSearchUrl } from "../../lib/googleMaps";
import { Card } from "../ui/Card";

interface Props {
  destination: string;
  locations: string[];
  selectedQuery: string;
  onSelectQuery: (query: string) => void;
}

export function TripMapView({ destination, locations, selectedQuery, onSelectQuery }: Props) {
  const query = selectedQuery || destination;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <iframe
          key={query}
          title="旅行先の地図"
          src={buildMapEmbedUrl(query)}
          className="h-64 w-full border-0"
          loading="lazy"
        />
      </Card>

      <a
        href={buildMapSearchUrl(query)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-[14px] border border-white/50 py-2.5 text-sm font-medium text-accent active:bg-white/50"
      >
        <ExternalLink size={16} />
        「{query}」をGoogleマップで開く
      </a>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-600">登録した場所</p>
        <div className="space-y-2">
          <button
            onClick={() => onSelectQuery(destination)}
            className={`flex w-full items-center gap-2 rounded-[14px] border p-3 text-left text-sm active:bg-white/50 ${
              query === destination ? "border-accent bg-accent-light text-accent" : "border-white/50 bg-white/40 text-slate-700"
            }`}
          >
            <MapPin size={14} />
            {destination}(主な行き先)
          </button>
          {locations.map((loc) => (
            <button
              key={loc}
              onClick={() => onSelectQuery(loc)}
              className={`flex w-full items-center gap-2 rounded-[14px] border p-3 text-left text-sm active:bg-white/50 ${
                query === loc ? "border-accent bg-accent-light text-accent" : "border-white/50 bg-white/40 text-slate-700"
              }`}
            >
              <MapPin size={14} />
              {loc}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
