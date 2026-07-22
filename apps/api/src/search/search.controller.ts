import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  query(@Query('q') q = '', @Query('limit') limit?: string) {
    return this.search.semanticSearch(q, limit ? Number(limit) : 20);
  }
}
