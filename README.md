# ParserLib Extension

[![Проверка покрытия](https://github.com/BlackRavenoo/parserlib-extension/actions/workflows/coverage.yml/badge.svg?branch=master)](https://github.com/BlackRavenoo/parserlib-extension/actions/workflows/coverage.yml)
[![Покрытие строк](https://raw.githubusercontent.com/BlackRavenoo/parserlib-extension/coverage-badge/coverage.svg)](https://github.com/BlackRavenoo/parserlib-extension/actions/workflows/coverage.yml)

Расширение для скачивания манги и ранобэ с сайтов LibSocial. Откройте страницу произведения, выберите главы и получите файл в формате FB2, EPUB или PDF. Проект использует идеи [parserlib](https://github.com/BlackRavenoo/parserlib), но работает прямо в браузере.

## Поддерживаемые источники

| Сайт | Содержимое |
| --- | --- |
| [MangaLib](https://mangalib.me/) (`mangalib.me`, `mangalib.org`) | Манга |
| [HentaiLib](https://hentailib.me/) | Манга |
| [RanobeLib](https://ranobelib.me/) | Ранобе |

## Форматы и возможности

Все форматы доступны для каждого поддерживаемого источника. Диапазон выбирается по названиям глав.

| Формат | Дополнение существующего файла |
| --- | --- |
| FB2 | - |
| EPUB | + |
| PDF | - |

При дополнении EPUB расширение определяет уже записанные главы по их ID и не скачивает их повторно.

## Установка из исходников

Нужен Node.js и npm. В CI используется Node.js 24.

```bash
npm ci
npm run build
```

**Chrome и Edge:** откройте `chrome://extensions` или `edge://extensions`, включите режим разработчика, нажмите **Load unpacked / Загрузить распакованное** и выберите папку `dist/`.

**Firefox:** откройте `about:debugging`, выберите **This Firefox / Этот Firefox**, нажмите **Load Temporary Add-on / Загрузить временное дополнение** и укажите файл `dist/manifest.json`. Временное дополнение нужно загрузить снова после перезапуска Firefox.

После изменения кода выполните `npm run build` снова и нажмите **Reload / Перезагрузить** на странице управления расширениями.

## Как скачать

1. Откройте страницу произведения на поддерживаемом сайте. Если сайт требует авторизацию, войдите в свой аккаунт.
2. Нажмите на значок расширения, выберите формат и начальную и конечную главы.
3. Для докачки EPUB включите соответствующий переключатель и выберите файл, созданный этим расширением.
4. Нажмите **Скачать**. Ход загрузки появится в отдельной вкладке, а готовый файл сохранится через браузер.

## Разработка

```bash
npm test             # тесты
npm run coverage     # покрытие кода и HTML-отчёт в coverage/
npx tsc --noEmit     # проверка типов
npm run zip          # сборка ZIP-архива расширения
```

Coverage workflow запускается при push в `master` и для pull request. Показатель на бейдже — **покрытие строк** файлов `src/**/*.ts`; он обновляется по результату push в `master`. Полный отчёт можно скачать из артефакта `coverage-report` на странице запуска workflow.
