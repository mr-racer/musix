"""Seed an isolated e2e stack: fresh SQLite (owner + sharing mode) and a
throwaway Qdrant collection with three generated tracks."""
import os, sys, time, uuid, random
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))  # the repo root: v1 is imported where it lives, unedited
from app.resources.metadata_db import MetadataDB
from app.services.auth_service import AuthService
from qdrant_client import QdrantClient, models

MetadataDB.init()
MetadataDB.set_instance_config(mode="sharing", created_at=time.time())
auth = AuthService(jwt_secret=os.environ["MUSIX_JWT_SECRET"])
uid = auth.create_owner(email="e2e@example.com", password="e2e-password-123")
coll = f"acct_{uid}"
q = QdrantClient(url=os.environ["QDRANT_URL"], trust_env=False)
q.create_collection(coll,
    vectors_config={"text": models.VectorParams(size=1024, distance=models.Distance.COSINE),
                    "clap": models.VectorParams(size=512, distance=models.Distance.COSINE)},
    sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)})
music = os.environ["E2E_MUSIC"]
pts = []
for i in (1, 2, 3):
    pts.append(models.PointStruct(id=str(uuid.uuid4()),
        vector={"text": [random.random() for _ in range(1024)], "clap": [random.random() for _ in range(512)]},
        payload={"title": f"E2E Track {i}", "artist": "E2E Artist", "album": "E2E Album", "year": 2024,
                 "genre": "Test", "duration": 150.0, "track_number": i,
                 "file_path": os.path.join(music, f"track{i}.mp3"), "lyrics": "",
                 "artist_slugs": ["e2e-artist"], "primary_artist_slug": "e2e-artist"}))
q.upsert(coll, pts)
print("owner", uid, "points", q.count(coll).count)
