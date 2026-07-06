import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, Globe, Star } from "lucide-react";

// Languages supported by LENORY's voice transcription engine.
// Nigerian-relevant languages are flagged and shown first — everything else
// is the full underlying multilingual speech model's language set.
const NIGERIA_RELEVANT = ["English", "Yoruba", "Hausa", "Swahili", "Arabic", "French"];

const ALL_LANGUAGES = [
  "English", "Yoruba", "Hausa", "Swahili", "Arabic", "French",
  "Afrikaans", "Albanian", "Amharic", "Armenian", "Assamese", "Azerbaijani",
  "Bashkir", "Basque", "Belarusian", "Bengali", "Bosnian", "Breton", "Bulgarian",
  "Burmese", "Cantonese", "Catalan", "Chinese", "Croatian", "Czech", "Danish",
  "Dutch", "Estonian", "Faroese", "Finnish", "Galician", "Georgian", "German",
  "Greek", "Gujarati", "Haitian Creole", "Hawaiian", "Hebrew", "Hindi",
  "Hungarian", "Icelandic", "Indonesian", "Italian", "Japanese", "Javanese",
  "Kannada", "Kazakh", "Khmer", "Korean", "Lao", "Latin", "Latvian",
  "Lingala", "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy", "Malay",
  "Malayalam", "Maltese", "Maori", "Marathi", "Mongolian", "Nepali",
  "Norwegian", "Norwegian Nynorsk", "Occitan", "Pashto", "Persian", "Polish",
  "Portuguese", "Punjabi", "Romanian", "Russian", "Sanskrit", "Serbian",
  "Shona", "Sindhi", "Sinhala", "Slovak", "Slovenian", "Somali", "Spanish",
  "Sundanese", "Tagalog", "Tajik", "Tamil", "Tatar", "Telugu", "Thai",
  "Tibetan", "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uzbek",
  "Vietnamese", "Welsh", "Yiddish",
];

export default function Languages() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ALL_LANGUAGES.filter((l) => l.toLowerCase().includes(q)) : ALL_LANGUAGES;
    return [...list].sort((a, b) => a.localeCompare(b));
  }, [query]);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation(-1 as any)} data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-purple-500" />
            Languages
          </h1>
          <p className="text-muted-foreground text-sm">LENORY understands and transcribes {ALL_LANGUAGES.length}+ languages.</p>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search languages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          data-testid="input-language-search"
        />
      </div>

      {!query && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm font-medium mb-3 flex items-center gap-1.5">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" /> Popular in Nigeria
            </p>
            <div className="flex flex-wrap gap-2">
              {NIGERIA_RELEVANT.map((lang) => (
                <span key={lang} className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                  {lang}
                </span>
              ))}
              <span className="px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-sm">
                Nigerian Pidgin (via English)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm font-medium mb-3 text-muted-foreground">
            {query ? `${filtered.length} result${filtered.length === 1 ? "" : "s"}` : "All supported languages"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {filtered.map((lang) => (
              <p key={lang} className="text-sm py-1">{lang}</p>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full text-center py-6">No languages match "{query}"</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
