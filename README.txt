Vokabeltrainer 4.1 – tolerantere Korrektur

Neu:
- Satzzeichen werden beim Vergleich ignoriert:
  ?, !, ., ,, :, ;, -, Apostrophe usw.
- Leerzeichen werden ignoriert.
- Akzentzeichen/Diakritika werden beim Vergleich ebenfalls tolerant behandelt.
  Beispiel: "ca sonne" wird für "Ça sonne !" als richtig erkannt.
- Groß-/Kleinschreibung spielt weiterhin keine Rolle.
- Bei nur kleinen Tipp- oder Scribble-Abweichungen erscheint:
  "✓ Habe ich gewusst"
- Dieser Button ist NUR bei kleinen Abweichungen sichtbar.
- Beim Klick wird der bereits gespeicherte "fast richtig"-Versuch sauber in "richtig"
  umgewandelt; es entsteht keine zusätzliche Abfrage.
- Im Testmodus gibt es diesen Selbstkorrektur-Button bewusst nicht.

Definition "kleine Abweichung":
- Levenshtein-Abstand abhängig von der Wortlänge
- mindestens 80 % Ähnlichkeit
- höchstens 1–3 Zeichen Abweichung
- größere Unterschiede bleiben falsch

Nach GitHub-Upload mit ?v=41 öffnen.
