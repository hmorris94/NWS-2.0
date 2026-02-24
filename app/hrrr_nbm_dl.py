from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlencode

import requests


@dataclass(frozen=True)
class BBox:
    leftlon: float
    rightlon: float
    toplat: float
    bottomlat: float

    def normalized(self) -> "BBox":
        # Ensure ordering
        left = min(self.leftlon, self.rightlon)
        right = max(self.leftlon, self.rightlon)
        bottom = min(self.bottomlat, self.toplat)
        top = max(self.bottomlat, self.toplat)
        return BBox(left, right, top, bottom)


@dataclass(frozen=True)
class Cycle:
    model: str         # "hrrr" or "nbm"
    yyyymmdd: str      # e.g. "20260129"
    hour: int          # 0-23


def _listdir_hrefs(url: str, session: requests.Session, timeout: int = 20) -> List[str]:
    """Parse NOMADS-style directory listing hrefs."""
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    # Directory listings are simple <a href="name">name</a>
    return re.findall(r'href="([^"]+)"', r.text)


def _stable_hash(parts: Sequence[str], n: int = 10) -> str:
    h = hashlib.sha256(("|".join(parts)).encode("utf-8")).hexdigest()
    return h[:n]


def bbox_from_points(points: Sequence[Tuple[float, float]], padding_km: float = 50.0) -> BBox:
    """
    Compute a union bbox with a crude km->deg padding.
    Good enough for subsetting; if you need precision, use geodesics.
    """
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    bottom = min(lats)
    top = max(lats)
    left = min(lons)
    right = max(lons)

    # Approx conversions:
    # 1 deg lat ~ 111 km
    pad_lat = padding_km / 111.0
    # 1 deg lon ~ 111*cos(lat) km; use mid-lat for conversion
    mid_lat = 0.5 * (bottom + top)
    pad_lon = padding_km / (111.0 * max(0.1, abs(__import__("math").cos(__import__("math").radians(mid_lat)))))

    return BBox(
        leftlon=left - pad_lon,
        rightlon=right + pad_lon,
        toplat=top + pad_lat,
        bottomlat=bottom - pad_lat,
    ).normalized()


def _latest_hrrr_cycle(session: requests.Session) -> Cycle:
    """
    Find newest HRRR cycle by directory listing:
      /pub/data/nccf/com/hrrr/prod/ -> hrrr.YYYYMMDD/
      /pub/data/nccf/com/hrrr/prod/hrrr.YYYYMMDD/conus/ -> files hrrr.tHHz.wrfsfcf00.grib2
    """
    root = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/hrrr/prod/"
    hrefs = _listdir_hrefs(root, session)
    dates = sorted(
        {m.group(1) for h in hrefs if (m := re.match(r"hrrr\.(\d{8})/", h))}
    )
    if not dates:
        raise RuntimeError(f"Could not find any HRRR date dirs at {root}")
    yyyymmdd = dates[-1]

    conus = f"{root}hrrr.{yyyymmdd}/conus/"
    fhrefs = _listdir_hrefs(conus, session)
    hours = sorted(
        {int(m.group(1)) for h in fhrefs if (m := re.match(r"hrrr\.t(\d{2})z\.wrfsfcf00\.grib2$", h))}
    )
    if not hours:
        raise RuntimeError(f"Could not find HRRR cycles in {conus}")
    return Cycle("hrrr", yyyymmdd, hours[-1])


def _latest_nbm_cycle(session: requests.Session) -> Cycle:
    """
    Find newest NBM cycle by directory listing:
      /pub/data/nccf/com/blend/prod/ -> blend.YYYYMMDD/
      /pub/data/nccf/com/blend/prod/blend.YYYYMMDD/ -> HH/ dirs
    Prefer the latest HH that actually contains core/ with at least one .co.grib2 file.
    """
    root = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/blend/prod/"
    hrefs = _listdir_hrefs(root, session)
    dates = sorted(
        {m.group(1) for h in hrefs if (m := re.match(r"blend\.(\d{8})/", h))}
    )
    if not dates:
        raise RuntimeError(f"Could not find any BLEND date dirs at {root}")
    yyyymmdd = dates[-1]

    day = f"{root}blend.{yyyymmdd}/"
    hh_hrefs = _listdir_hrefs(day, session)
    hours = sorted({int(m.group(1)) for h in hh_hrefs if (m := re.match(r"(\d{2})/", h))}, reverse=True)
    if not hours:
        raise RuntimeError(f"Could not find BLEND cycle-hour dirs in {day}")

    # Walk backwards until we find a posted core file listing that looks complete enough.
    for hh in hours:
        core = f"{day}{hh:02d}/core/"
        try:
            core_hrefs = _listdir_hrefs(core, session)
        except requests.HTTPError:
            continue
        # Any CONUS core file for that cycle is enough to declare "available"
        # (you can tighten this to f001 or f006 if you want).
        if any(re.match(rf"blend\.t{hh:02d}z\.core\.f\d{{3}}\.co\.grib2$", x) for x in core_hrefs):
            return Cycle("nbm", yyyymmdd, hh)

    raise RuntimeError(f"Could not find a usable BLEND core listing in {day}")


def _build_filter_url(
    base: str,
    dir_value: str,
    file_value: str,
    bbox: BBox,
    vars_: Sequence[str],
    levels: Sequence[str],
) -> str:
    """
    Build a NOMADS filter URL (filter_hrrr_2d.pl or filter_blend.pl).
    """
    params: Dict[str, str] = {
        "dir": dir_value,
        "file": file_value,
        "subregion": "",
        "leftlon": f"{bbox.leftlon:.6f}",
        "rightlon": f"{bbox.rightlon:.6f}",
        "toplat": f"{bbox.toplat:.6f}",
        "bottomlat": f"{bbox.bottomlat:.6f}",
    }
    for lev in levels:
        params[f"lev_{lev}"] = "on"
    for v in vars_:
        params[f"var_{v}"] = "on"
    return f"{base}?{urlencode(params)}"


def _download_if_needed(
    url: str,
    out_path: Path,
    session: requests.Session,
    timeout: int = 120,
) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path

    tmp = out_path.with_suffix(out_path.suffix + ".part")
    with session.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
    os.replace(tmp, out_path)
    return out_path


def sync_hrrr_nbm_subsets(
    locations: Sequence[Dict[str, float]],
    cache_dir: str | Path,
    padding_km: float = 50.0,
    # Forecast hours to pull
    hrrr_fhrs: Sequence[int] = tuple(range(0, 19)),          # f00..f18 for "shape"
    nbm_fhrs: Sequence[int] = tuple(range(1, 37)),           # f001..f036 hourly window
    # Variables (override as you refine)
    hrrr_vars: Sequence[str] = ("APCP", "ASNOW", "CRAIN", "CSNOW", "CICEP", "CFRZR"),
    nbm_vars: Sequence[str] = ("APCP", "ASNOW", "FICEAC", "PTYPE"),
    # Levels (strings are whatever comes after "lev_" in filter endpoint)
    hrrr_levels: Sequence[str] = ("surface",),
    nbm_levels: Sequence[str] = ("surface",),
    min_delay_s: float = 10.0,  # be polite to NOMADS filter endpoints
    session: Optional[requests.Session] = None,
) -> Dict[str, object]:
    """
    1) Find newest HRRR and NBM cycles via NOMADS directory listings
    2) Generate filter URLs for a padded bbox covering your locations
    3) Download + cache GRIB2 subsets with deterministic filenames

    Returns metadata including chosen cycles, bbox, urls, and local paths.

    Notes:
    - Uses NOMADS filter endpoints (server-side subsetting). For high volume, consider S3 + local subsetting.
    - Deterministic filenames include model/cycle/fhr + hashes of bbox & varset.
    """
    sess = session or requests.Session()
    cache = Path(cache_dir)

    points = [(float(x["lat"]), float(x["lon"])) for x in locations]
    bbox = bbox_from_points(points, padding_km=padding_km).normalized()
    bbox_tag = _stable_hash([f"{bbox.leftlon:.6f}", f"{bbox.rightlon:.6f}", f"{bbox.toplat:.6f}", f"{bbox.bottomlat:.6f}"], 12)

    hrrr_cycle = _latest_hrrr_cycle(sess)
    nbm_cycle = _latest_nbm_cycle(sess)

    results: Dict[str, object] = {
        "bbox": bbox,
        "hrrr_cycle": hrrr_cycle,
        "nbm_cycle": nbm_cycle,
        "hrrr": [],
        "nbm": [],
    }

    # --- HRRR downloads ---
    hrrr_base = "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl"
    hrrr_var_tag = _stable_hash(sorted(hrrr_vars) + [f"lev:{x}" for x in sorted(hrrr_levels)], 10)

    for i, fhr in enumerate(hrrr_fhrs):
        file_value = f"hrrr.t{hrrr_cycle.hour:02d}z.wrfsfcf{fhr:02d}.grib2"
        dir_value = f"/hrrr.{hrrr_cycle.yyyymmdd}/conus"
        url = _build_filter_url(hrrr_base, dir_value, file_value, bbox, hrrr_vars, hrrr_levels)

        out_name = f"hrrr_{hrrr_cycle.yyyymmdd}_t{hrrr_cycle.hour:02d}_f{fhr:02d}_{bbox_tag}_{hrrr_var_tag}.grib2"
        out_path = cache / "hrrr" / hrrr_cycle.yyyymmdd / f"t{hrrr_cycle.hour:02d}" / out_name

        path = _download_if_needed(url, out_path, sess)
        results["hrrr"].append({"fhr": fhr, "url": url, "path": str(path)})

        if min_delay_s and i != len(hrrr_fhrs) - 1:
            time.sleep(min_delay_s)

    # --- NBM downloads ---
    nbm_base = "https://nomads.ncep.noaa.gov/cgi-bin/filter_blend.pl"
    nbm_var_tag = _stable_hash(sorted(nbm_vars) + [f"lev:{x}" for x in sorted(nbm_levels)], 10)

    for i, fhr in enumerate(nbm_fhrs):
        file_value = f"blend.t{nbm_cycle.hour:02d}z.core.f{fhr:03d}.co.grib2"
        dir_value = f"/blend.{nbm_cycle.yyyymmdd}/{nbm_cycle.hour:02d}/core"
        url = _build_filter_url(nbm_base, dir_value, file_value, bbox, nbm_vars, nbm_levels)

        out_name = f"nbm_{nbm_cycle.yyyymmdd}_t{nbm_cycle.hour:02d}_f{fhr:03d}_{bbox_tag}_{nbm_var_tag}.grib2"
        out_path = cache / "nbm" / nbm_cycle.yyyymmdd / f"t{nbm_cycle.hour:02d}" / out_name

        path = _download_if_needed(url, out_path, sess)
        results["nbm"].append({"fhr": fhr, "url": url, "path": str(path)})

        if min_delay_s and i != len(nbm_fhrs) - 1:
            time.sleep(min_delay_s)

    return results


# ---- Example usage ----
if __name__ == "__main__":
    locations = [
        {"name": "Sterling, VA", "lat": 39.0067, "lon": -77.4286},
        {"name": "Frederick, MD", "lat": 39.4143, "lon": -77.4105},
        {"name": "Broadway, VA", "lat": 38.6132, "lon": -78.7989},
        {"name": "Midlothian, VA", "lat": 37.5057, "lon": -77.6499},
        {"name": "Hatteras, NC", "lat": 35.2193, "lon": -75.6907},
    ]

    meta = sync_hrrr_nbm_subsets(
        locations=locations,
        cache_dir=Path(__file__).resolve().parent.parent / "wx_cache",
        padding_km=50.0,
        # tighten to what you truly need while iterating:
        hrrr_fhrs=range(0, 19),
        nbm_fhrs=range(1, 37),
        min_delay_s=10.0,
    )
    print(meta["hrrr_cycle"], meta["nbm_cycle"])
    print("HRRR files:", len(meta["hrrr"]))
    print("NBM files:", len(meta["nbm"]))
