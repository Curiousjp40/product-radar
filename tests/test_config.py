from engine.config import load_all


def test_load_all_returns_every_config_file():
    cfg = load_all()
    assert set(cfg.keys()) == {"settings", "creators", "categories", "weights", "seasons", "hooks"}
    assert "target_categories" in cfg["settings"]
    assert "roxm___" in cfg["creators"]
    assert "categories" in cfg["categories"]
    assert "momentum" in cfg["weights"]
    assert "events" in cfg["seasons"]
    assert "hooks" in cfg["hooks"]
    assert "shot_lists" in cfg["hooks"]
