def test_list_rates_match_engine_detail(client):
    cards = client.get("/api/tariff/impacts").json()
    assert len(cards) == 8
    o5 = next(card for card in cards if card["order_id"] == "O5")
    assert o5["rate_baseline_user_pct"] == 16.9
    assert o5["rate_new_pct"] == 41.9
    for card in cards:
        detail = client.get(f'/api/tariff/impacts/{card["order_id"]}').json()
        for key in ("rate_baseline_user_pct", "rate_new_pct"):
            assert card[key] == detail[key]
