PRAGMA foreign_keys = ON;

INSERT INTO tournaments (id, academic_year, name, survey_start, survey_end, status)
VALUES ('event-2026-second-half-application', 2026, '동부학교스포츠클럽 후반기 대회', '2026-08-23T15:00:00.000Z', '2026-09-04T09:00:00.000Z', 'active');
INSERT INTO app_config (id, active_tournament_id) VALUES (1, 'event-2026-second-half-application');

INSERT INTO sports (id, tournament_id, name, display_order, team_count_enabled, max_teams_per_school) VALUES
  ('sport-volleyball', 'event-2026-second-half-application', '배구', 1, 1, 2),
  ('sport-basketball-3x3', 'event-2026-second-half-application', '3x3 농구', 2, 1, 2),
  ('sport-dodgeball', 'event-2026-second-half-application', '피구', 3, 0, 2);
INSERT INTO divisions (id, sport_id, name, display_order) VALUES
  ('division-volleyball-male', 'sport-volleyball', '남중부', 1),
  ('division-volleyball-female', 'sport-volleyball', '여중부', 2),
  ('division-basketball-male', 'sport-basketball-3x3', '남중부', 1),
  ('division-basketball-female', 'sport-basketball-3x3', '여중부', 2),
  ('division-dodgeball-male', 'sport-dodgeball', '남중부', 1),
  ('division-dodgeball-female', 'sport-dodgeball', '여중부', 2);

INSERT INTO schools (id, name, display_order, password_salt, password_hash, password_iterations) VALUES
  ('school-001', '동인천중학교', 1, 'mluf5mFixwACRu6uPk3A8A', 'EnIb3IebFdHqTUiZjB2oTnlxoUuAAsyzdTInYdWRikQ', 25000),
  ('school-002', '상인천중학교', 2, 'EVGiMkQKor2NmSx3U1tILw', 'r1W1JNKED4IanooeCibSPStB5091ZvKE1pnkkRZ2vzg', 25000),
  ('school-003', '구월중학교', 3, 'ZZht0PmX27uvJmRX3slRCg', 'vVPynFYuXYeL414V5B7JKp0K0SDQIoiZyBbEtMrQB_E', 25000),
  ('school-004', '인송중학교', 4, 'gc6YM1OzFMYKfwl-ojOMtA', 'tJ3RgTyAUbkkBB9m8TDybfMQ8a71as4VBQA9PJzFbmY', 25000),
  ('school-005', '만수중학교', 5, 'HoSDSFL3bjNS5XZzgGAC8Q', '-zFzvy2hPbuhe0JeQSsla0aZMML_2kJ1MMZzRkwAfjg', 25000),
  ('school-006', '상인천여자중학교', 6, 'k9NA3v4IgF_jHdnd-BzgjA', 'GTqUQE4w4aADXy1_h-ben2k-4PmQHkZNyQobNVByLjM', 25000),
  ('school-007', '간석여자중학교', 7, 'TVZvJx_3Jds1OQc3pSF9fw', 'vvY4_Py0WVQ7Tm1QJCr1wIM6fXO99IWqLasU53iW9TI', 25000),
  ('school-008', '만수북중학교', 8, 'DuxHFrhqef5gUvPXgyrC-A', 'pFdieBTirfb2JgjZ-_TTgGnDzLdP2zl1g-F-YeYcuqw', 25000),
  ('school-009', '만수여자중학교', 9, 'gbZpgLCimP1CjNygMoSgjA', 'hdaaMqt5ITI7fFVutd6kZq_0ESh9UUBDdFO24ukxAw4', 25000),
  ('school-010', '구월여자중학교', 10, 'rFK6EWwf2ELUqdgXk8QWEw', 'X8-YKitxgJqiI244LTZH_hDQ3v2GnSJzDZD0dnOPqa8', 25000),
  ('school-011', '만월중학교', 11, '9PAY8hHqXfQWhcAOUOqnTQ', '1LOwPHo4SkYRypJJkdTnjFuqrSfFo2EnhUQtb5g55jM', 25000),
  ('school-012', '남동중학교', 12, 'KUaU06eZd-zJiNIoTT2fsw', '6yZwVRUx-b1uhn8kFsy79frOC_QgHQL0nyi3JZWgMww', 25000),
  ('school-013', '선학중학교', 13, '3fpv-FxhD9fwvzyEAEvmWQ', 'q-J9LAG_GHUQZErSDgRnEgwpR7LjE1B2GSG2MS1CTY0', 25000),
  ('school-014', '연수중학교', 14, 'EIA8DupTOWnNfH5TO9w26A', 'qjWP-ayfGOMb1lNs5sOiGdUWtn3yKC1M1sK-JYk6pd4', 25000),
  ('school-015', '연성중학교', 15, 'QatH2m0YlF4B_dueapQNWg', 'kPYQh6CmUTtR4DhPJ_lKpypm57gSXaUAv4GzBexI9wM', 25000),
  ('school-016', '만성중학교', 16, 'Q1dAj4zzfgGLP_HxJJ2HQg', 'ZauA9QRUZEiZn5aLCX3Zp9zsK-K8CH20SFk3IXt4C9E', 25000),
  ('school-017', '청학중학교', 17, 'lkWv0p3NjALgZep7oEQatQ', 'IOzd4JKFHXPdbZeGBjKhLLN9l1ssSDZz3S8-XkmGR3g', 25000),
  ('school-018', '청량중학교', 18, 'I-PiAu0ee6ZyZ7ZZPR2tZA', '9OuzAZBh8Vukgcv_9R1v9-yS8789QowOqRtcWZrlXx4', 25000),
  ('school-019', '인천여자중학교', 19, 'bQRXmEsQWKjtdK0I5md-gg', '4v70UsEDn3NyzakwXVa1hnV5t0insyvgA-VH8OIlXRU', 25000),
  ('school-020', '옥련중학교', 20, '7OMz9kglnolMbSd2VQE4qQ', 'WaZfX3iXCIi0DuseW_IJ9DkzQ7hhUsLfdAqmxwR64do', 25000),
  ('school-021', '연화중학교', 21, 'RYl6XVCz96a9woMKCeQDMw', 'L1Jv6sojdM1-nw2tfEejfSo-doeXDHF3aODFlc0_h4I', 25000),
  ('school-022', '인천중학교', 22, 'kbfYgIJWqS2znSswjimJNA', 'CaKpRzet0jdwe-5lIdBoxq22CzJyca7SImkK91632mQ', 25000),
  ('school-023', '논곡중학교', 23, 'Jk2ebisWqqqwgqphIf0Zng', 'WYsxw8-YqYmNoyB2rGm6dd7fA3qu3MdlbJTw6ud8kHQ', 25000),
  ('school-024', '함박중학교', 24, '0ERH_Z5VFJOz5hYSqaPMCw', '1lyG8BxBmu492e3AFdtD1avZx_YQI6yWBFpgqxqAqcw', 25000),
  ('school-025', '석정중학교', 25, 'quyHzIS7YY091QjFslfo9A', 'AAQDqtriMrF-elPJoUh_GvgK5fhQTV57RQ-pkwjbJgU', 25000),
  ('school-026', '능허대중학교', 26, 'HgJdm0khAg1pcAgrSc-uNA', 'aCoVq9ZNMK-i_5coBaTD3XEG0LUlHbcGmflibc45JRw', 25000),
  ('school-027', '신송중학교', 27, 'QRWF7ia-hvJmE-N5SgIQEg', 'xSIOiGBiE-Q7iobPq1Ncz0avnCu8XUOhkRM4wPooI5U', 25000),
  ('school-028', '인천논현중학교', 28, 'UmStJGY97lOEBu4GVdYzhQ', 'Ky_i0q1BrarQG8hKgz7l7Hh274msubpfA6NwP2IbVIs', 25000),
  ('school-029', '인천성리중학교', 29, '5QxesTjgJV96wVLoFpM7Ag', 'oV2yQcjPjpfrBP5w6_u9m8NKn-RopYHgnjmLxQjwWPQ', 25000),
  ('school-030', '인천동방중학교', 30, '2gGYlhI408LmlOfXYsNlVw', 'vSl-ZCDJptMJ_wR-EjuIcco8FeEj9MKcNRVlPQlq-tE', 25000),
  ('school-031', '인천정각중학교', 31, 'pLn4OIsrkUvkUHwEYH_SGg', 'YhZUkOztEkQJKe_06BmJf2fORbInq3B2zf1fdfgjR3M', 25000),
  ('school-032', '인천서창중학교', 32, 'KpOQ6I0aSxQgj5zzSDl7RQ', '6PiaRKmtTNtJ_lXF9APMSnBRrR3IGn2Kk_EgqGE8ISU', 25000),
  ('school-033', '인천해송중학교', 33, 'auepik44GU0AslGpuR7nww', '0Bl1ZA08-JiTBvweDLvbEp0izp7vrgkxb0MJuuTH_eo', 25000),
  ('school-034', '인천고잔중학교', 34, '0lF5oaHB3b9z74fLoWI-mQ', 'QJ6HPMdv5ioZpPy8nJp2jArP0GnJqGUb6kpXugsx3a8', 25000),
  ('school-035', '인천사리울중학교', 35, '2m-wOio-SzfG9P2buFMwlw', 'HycsM82rqXBTH8YueIVRNWKvKxaRn3QpuA31gFAdy5I', 25000),
  ('school-036', '인천신정중학교', 36, 'eSHSlAcHrl7t8Xmnw-ONQg', '9NmWsIefu8J9PcH8shvZ1uHN3-9OWuuUv81innORZok', 25000),
  ('school-037', '인천예송중학교', 37, 'gRiCEaVEURyi9GbQKOdBDw', '1Q_OIQCYWngfXzz-MDrOGs_FdzoQilvAq225USF-DHs', 25000),
  ('school-038', '인천미송중학교', 38, 'R9mCs1rw5r4aocC9g3VXuA', '8ggJumuhbma4nz_OA0aqjBsj1DWDISz4Jdr1KXNPlO4', 25000),
  ('school-039', '인천현송중학교', 39, 'BkZVfdTVN4UdNe2s-kvb9w', '1pGenNrhQHxu2c-nN_9M1B25JgH7Ep3W9r8xGuQeqLA', 25000),
  ('school-040', '인천은송중학교', 40, 'OEwNE1NFFIsoQCKkRvBZkQ', 'kqehTRxj7MNLBDkTYCWq2c8_rW3l0krbkhKGFw3sAT4', 25000),
  ('school-041', '숭덕여자중학교', 41, 'fp4oxEzjvW-FykTT7dLDxw', 'bd6-bXgy-0PjJTCApH5RxJqxnYO5YHErgwQYtezg8oA', 25000),
  ('school-042', '박문중학교', 42, 'ITat_fuQzFYOJkog1qQxGQ', 'XOunrZA9y3zTKXPrcH_dvy-mEf3vkBLApa-wrjN1KJc', 25000);

PRAGMA optimize;
