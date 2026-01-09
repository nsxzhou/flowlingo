import csv
import json
import hashlib
import os

def get_hash(filename):
    sha256_hash = hashlib.sha256()
    with open(filename, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def process_dictionary():
    print("Processing CSV records...")
    oxford3000 = []
    plus2000 = []
    plus5000 = []
    
    seen_words = set()
    temp_file = "ecdict_temp.csv"
    
    # 1. Get Oxford 3000
    with open(temp_file, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = row.get('word', '')
            if not word: continue
            if row.get('oxford', '') == '1':
                translation = row.get('translation', '')
                clean_translation = translation.replace('\n', ' ').strip().strip('"')
                item = {
                    "id": f"w_{word.replace(' ', '_').lower()}",
                    "cn": clean_translation,
                    "en": word,
                    "level": 3000
                }
                oxford3000.append(item)
                seen_words.add(word.lower())

    # 2. Get Candidates for others (sorted by BNC rank)
    candidates = []
    with open(temp_file, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = row.get('word', '')
            if not word or word.lower() in seen_words: continue
            
            bnc = row.get('bnc', '0')
            try:
                bnc_rank = int(bnc)
            except:
                bnc_rank = 999999
            
            if bnc_rank > 0 and bnc_rank <= 20000:
                candidates.append(row)
    
    candidates.sort(key=lambda x: int(x.get('bnc', '999999')))

    # 3. Fill plus-2000 (to reach 5000)
    for row in candidates[:2000]:
        word = row.get('word', '')
        translation = row.get('translation', '')
        plus2000.append({
            "id": f"w_{word.replace(' ', '_').lower()}",
            "cn": translation.replace('\n', ' ').strip().strip('"'),
            "en": word,
            "level": 5000
        })
        seen_words.add(word.lower())

    # 4. Fill plus-5000 (to reach 10000)
    remaining_candidates = [c for c in candidates if c.get('word', '').lower() not in seen_words]
    for row in remaining_candidates[:5000]:
        word = row.get('word', '')
        translation = row.get('translation', '')
        plus5000.append({
            "id": f"w_{word.replace(' ', '_').lower()}",
            "cn": translation.replace('\n', ' ').strip().strip('"'),
            "en": word,
            "level": 10000
        })

    # Write JSONL files
    files = {
        "core-3000.jsonl": oxford3000,
        "plus-2000.jsonl": plus2000,
        "plus-5000.jsonl": plus5000
    }
    
    for filename, data in files.items():
        with open(filename, "w", encoding="utf-8") as f:
            for item in data:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")

    # Update packages.json
    with open("packages.json", "r", encoding="utf-8") as f:
        packages_data = json.load(f)
    
    for pkg in packages_data["packages"]:
        filename = f"{pkg['id']}.jsonl"
        if filename in files:
            pkg["entries"] = len(files[filename])
            pkg["hash"] = get_hash(filename)
            pkg["publishedAt"] = "2026-01-08"

    with open("packages.json", "w", encoding="utf-8") as f:
        json.dump(packages_data, f, ensure_ascii=False, indent=2)

    print(f"Update summary:")
    print(f"- core-3000.jsonl: {len(oxford3000)} entries")
    print(f"- plus-2000.jsonl: {len(plus2000)} entries")
    print(f"- plus-5000.jsonl: {len(plus5000)} entries")
    print("packages.json updated with new hashes and counts.")

if __name__ == "__main__":
    process_dictionary()
